import api from '@/api';
import { FieldValues } from '@/components/v-form/types';
import { useServerStore } from '@/stores/server';
import { useSettingsStore } from '@/stores/settings';
import { useUserStore } from '@/stores/user';
import { translate } from '@/utils/translate-object-values';
import { DeepPartial, Field, SettingsOnboarding, User, UserOnboarding } from '@directus/types';
import { Ref, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { projectFields } from './fields/project';
import { themingProjectFields } from './fields/theming-project';
import { themingUserFields } from './fields/theming-user';
import { userFields } from './fields/user';

type OnboardingSlide = {
	title: string;
	text: string;
	form?: {
		model: Ref<FieldValues>;
		fields: DeepPartial<Field>[];
		initialValues: FieldValues;
	};
	next?: () => Promise<any>;
};

export function getSlides() {
	const { t } = useI18n();
	const settingsStore = useSettingsStore();
	const userStore = useUserStore();
	const serverStore = useServerStore();
	const router = useRouter();

	const projectModel = ref({
		project_name: settingsStore.settings?.project_name,
		project_url: settingsStore.settings?.project_url,
		project_logo: settingsStore.settings?.project_logo,
		project_color: settingsStore.settings?.project_color,
		project_use_case: settingsStore.settings?.onboarding?.project_use_case,
	});

	const themingProjectModel = ref({
		default_appearance: settingsStore.settings?.default_appearance,
		default_theme_light: settingsStore.settings?.default_theme_light,
		default_theme_dark: settingsStore.settings?.default_theme_dark,
	});

	const currentUser = userStore.currentUser as User;

	const userModel = ref({
		first_name: currentUser.first_name,
		last_name: currentUser.last_name,
		email: currentUser.email,
		wants_emails: currentUser.onboarding?.wants_emails ?? false,
		primary_skillset: currentUser.onboarding?.primary_skillset,
	});

	const themingUserModel = ref({
		appearance: currentUser.appearance,
		theme_light: currentUser.theme_light,
		theme_dark: currentUser.theme_dark,
	});

	const requiresProjectOnboarding = !settingsStore.settings?.onboarding;

	const slides: Record<string, OnboardingSlide> = {
		welcome: {
			title: t('onboarding.welcome.title'),
			text: t('onboarding.welcome.text'),
		},
		...(requiresProjectOnboarding && {
			project: {
				title: t('onboarding.project.title'),
				text: t('onboarding.project.text'),
				form: {
					model: projectModel,
					fields: translate(projectFields),
					initialValues: projectModel.value,
				},
				next: async function () {
					await settingsStore.updateSettings({
						project_name: projectModel.value.project_name,
						project_url: projectModel.value.project_url,
						project_logo: projectModel.value.project_logo,
						project_color: projectModel.value.project_color,
						onboarding: JSON.stringify({
							project_use_case: projectModel.value.project_use_case ?? null,
						} satisfies SettingsOnboarding),
					});

					await Promise.all([settingsStore.hydrate(), serverStore.hydrate({ isLanguageUpdated: false })]);
				},
			},
			themingProject: {
				title: t('onboarding.theming-project.title'),
				text: t('onboarding.theming-project.text'),
				form: {
					model: themingProjectModel,
					fields: translate(themingProjectFields),
					initialValues: themingProjectModel.value,
				},
				next: async function () {
					await settingsStore.updateSettings({
						default_appearance: themingProjectModel.value.default_appearance,
						default_theme_light: themingProjectModel.value.default_theme_light,
						default_theme_dark: themingProjectModel.value.default_theme_dark,
					});

					await Promise.all([settingsStore.hydrate(), serverStore.hydrate({ isLanguageUpdated: false })]);
				},
			},
		}),
		user: {
			title: t('onboarding.user.title'),
			text: t('onboarding.user.text'),
			form: {
				model: userModel,
				fields: translate(userFields),
				initialValues: userModel.value,
			},
			next: async function () {
				await api.patch(`/users/${currentUser.id}`, {
					first_name: userModel.value.first_name,
					last_name: userModel.value.last_name,
					email: userModel.value.email,
					onboarding: JSON.stringify({
						primary_skillset: userModel.value.primary_skillset ?? null,
						wants_emails: userModel.value.wants_emails ?? false,
						retry_transmission: true,
					} satisfies UserOnboarding),
				});

				await userStore.hydrate();
			},
		},
		themingUser: {
			title: t('onboarding.theming-user.title'),
			text: t('onboarding.theming-user.text'),
			form: {
				model: themingUserModel,
				fields: translate(themingUserFields),
				initialValues: themingUserModel.value,
			},
			next: async function () {
				await api.patch(`/users/${currentUser.id}`, {
					appearance: themingUserModel.value.appearance,
					theme_light: themingUserModel.value.theme_light,
					theme_dark: themingUserModel.value.theme_dark,
				} satisfies Partial<User>);

				await userStore.hydrate();

				// Proceed immediately and swallow any errors for seamless user experience
				api.post(`/onboarding/${currentUser.id}/send`).catch(() => {});

				router.replace('/content');
			},
		},

		finish: {
			title: t('onboarding.loading.title'),
			text: t('onboarding.loading.text'),
		},
	};

	return slides;
}
