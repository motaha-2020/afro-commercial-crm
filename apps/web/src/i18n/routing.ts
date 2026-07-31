import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

export const routing = defineRouting({
  locales: ['ar', 'en', 'fr'],
  defaultLocale: 'ar',
});

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

export type AppLocale = (typeof routing.locales)[number];

export function isSupportedLocale(value: string | undefined): value is AppLocale {
  return value !== undefined && (routing.locales as readonly string[]).includes(value);
}
