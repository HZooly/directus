import { findWorkspacePackagesNoCheck } from '@pnpm/find-workspace-packages';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import config from '../config.js';
import type { PackageVersion } from '../types.js';
import { sortByExternalOrder } from './sort.js';

export async function processPackages(): Promise<{
	mainVersion: string;
	isPrerelease: boolean;
	prereleaseId: string | undefined;
	packageVersions: PackageVersion[];
}> {
	const workspacePackages = await findWorkspacePackagesNoCheck(process.cwd());
	const packageVersions = new Map<string, string>();

	for (const localPackage of workspacePackages) {
		const { name, version } = localPackage.manifest;

		if (!name) {
			continue;
		}

		const changelogPath = join(localPackage.dir, 'CHANGELOG.md');

		// The package has been bumped if a changelog file is generated
		// (catches packages bumped solely due to internal dependency updates from changesets too)
		if (existsSync(changelogPath)) {
			if (version) {
				let finalVersion = version;

				// Reset 'version' field in private packages (falsely increased by changesets)
				if (localPackage.manifest.private) {
					finalVersion = '0.0.0';
					localPackage.manifest.version = finalVersion;
					await localPackage.writeProjectManifest(localPackage.manifest);
				}

				packageVersions.set(name, finalVersion);
			}

			// Remove changelog files generated by changeset in favor of release notes
			unlinkSync(changelogPath);
		}
	}

	const { mainVersion, manualMainVersion, isPrerelease, prereleaseId } = getVersionInfo();

	if (manualMainVersion) {
		const workspacePackage = workspacePackages.find((p) => p.manifest.name === config.mainPackage);

		if (workspacePackage) {
			workspacePackage.manifest.version = mainVersion;
			await workspacePackage.writeProjectManifest(workspacePackage.manifest);
			packageVersions.set(config.mainPackage, mainVersion);
		}
	}

	for (const [trigger, target] of config.linkedPackages) {
		if (packageVersions.has(trigger) && !packageVersions.has(target)) {
			const workspacePackage = workspacePackages.find((p) => p.manifest.name === target);

			if (workspacePackage && workspacePackage.manifest.version) {
				const bumpedVersion = semver.inc(
					workspacePackage.manifest.version,
					isPrerelease ? 'prerelease' : 'patch',
					prereleaseId
				);

				if (bumpedVersion) {
					workspacePackage.manifest.version = bumpedVersion;
					await workspacePackage.writeProjectManifest(workspacePackage.manifest);
					packageVersions.set(target, bumpedVersion);
				}
			}
		}
	}

	return {
		mainVersion,
		isPrerelease,
		prereleaseId,
		packageVersions: Array.from(packageVersions, ([name, version]) => ({
			name,
			version,
		}))
			.filter(({ name }) => ![config.mainPackage, ...Object.keys(config.untypedPackageTitles)].includes(name))
			.sort(sortByExternalOrder(config.packageOrder, 'name')),
	};

	function getVersionInfo() {
		const manualMainVersion = process.env['DIRECTUS_VERSION'];

		const mainVersion = semver.parse(manualMainVersion ?? packageVersions.get(config.mainPackage));

		if (!mainVersion) {
			throw new Error(`Main version ('${config.mainPackage}' package) is missing or invalid`);
		}

		const isPrerelease = mainVersion.prerelease.length > 0;
		let prereleaseId;

		if (isPrerelease) {
			let tag;

			try {
				const changesetPreFile = join(process.cwd(), '.changeset', 'pre.json');
				({ tag } = JSON.parse(readFileSync(changesetPreFile, 'utf8')));
			} catch {
				throw new Error(`Main version is a prerelease but changesets isn't in prerelease mode`);
			}

			prereleaseId = mainVersion.prerelease[0];

			if (typeof prereleaseId !== 'string') {
				throw new Error(`Expected a string for prerelease identifier`);
			}

			if (prereleaseId !== tag) {
				throw new Error(`Prerelease identifier of main version doesn't match tag of changesets prerelease mode`);
			}
		}

		return { mainVersion: mainVersion.version, manualMainVersion, isPrerelease, prereleaseId };
	}
}
