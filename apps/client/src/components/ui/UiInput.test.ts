import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import UiInput from './UiInput.vue';

const normalizeCode = (value: string): string =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);

describe('UiInput', () => {
  it('связывает подпись с полем', () => {
    const wrapper = mount(UiInput, { props: { label: 'Ваше имя' } });
    const label = wrapper.find('label');
    const input = wrapper.find('input');

    expect(label.text()).toContain('Ваше имя');
    expect(label.attributes('for')).toBe(input.attributes('id'));
    expect(input.attributes('id')).toBeTruthy();
  });

  it('не рендерит подпись без label', () => {
    const wrapper = mount(UiInput);

    expect(wrapper.find('span').exists()).toBe(false);
  });

  it('пробрасывает нативные атрибуты на input', () => {
    const wrapper = mount(UiInput, {
      attrs: { placeholder: 'Например, Аня', maxlength: '20', autocomplete: 'nickname' },
    });
    const input = wrapper.find('input');

    expect(input.attributes('placeholder')).toBe('Например, Аня');
    expect(input.attributes('maxlength')).toBe('20');
    expect(input.attributes('autocomplete')).toBe('nickname');
  });

  it('обновляет v-model при вводе', async () => {
    const wrapper = mount(UiInput);
    const input = wrapper.find('input');

    await input.setValue('Аня');

    expect(wrapper.emitted('update:modelValue')).toEqual([['Аня']]);
    expect((input.element as HTMLInputElement).value).toBe('Аня');
  });

  it('показывает переданное значение', () => {
    const wrapper = mount(UiInput, { props: { modelValue: 'Боб' } });

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('Боб');
  });

  it('нормализует значение до записи в v-model', async () => {
    const wrapper = mount(UiInput, { props: { normalize: normalizeCode } });
    const input = wrapper.find('input');

    await input.setValue('abc-234');

    expect(wrapper.emitted('update:modelValue')).toEqual([['ABC234']]);
    expect((input.element as HTMLInputElement).value).toBe('ABC234');
  });

  it('добавляет моноширинный стиль для варианта code', () => {
    const plain = mount(UiInput).find('input').classes();
    const code = mount(UiInput, { props: { variant: 'code' } }).find('input').classes();

    expect(code).toHaveLength(plain.length + 1);
  });
});
