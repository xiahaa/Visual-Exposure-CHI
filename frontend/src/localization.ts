import type { Scenario, StudyLanguage } from './types';

export type LocalizedCopy = { en: string; zh: string };

export function textFor(language: StudyLanguage, copy: LocalizedCopy): string {
  return copy[language];
}

export function scenarioText(
  scenario: Scenario,
  language: StudyLanguage,
  field: 'name' | 'task' | 'notice',
): string {
  if (language === 'zh') {
    const translated = scenario.translations?.zh?.[field];
    if (translated) return translated;
  }
  if (field === 'name') return scenario.name;
  return scenario.summary[field];
}
