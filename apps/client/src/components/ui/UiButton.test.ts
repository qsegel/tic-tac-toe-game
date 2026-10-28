import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import UiButton from './UiButton.vue';

describe('UiButton', () => {
  it('рендерит слот и не сабмитит форму по умолчанию', () => {
    const wrapper = mount(UiButton, { slots: { default: 'Создать игру' } });

    expect(wrapper.element.tagName).toBe('BUTTON');
    expect(wrapper.text()).toBe('Создать игру');
    expect(wrapper.attributes('type')).toBe('button');
  });

  it('передаёт type, чтобы работал submit формы', () => {
    const wrapper = mount(UiButton, { props: { type: 'submit' } });

    expect(wrapper.attributes('type')).toBe('submit');
  });

  it('вызывает обработчик клика', async () => {
    const onClick = vi.fn();
    const wrapper = mount(UiButton, { attrs: { onClick } });

    await wrapper.trigger('click');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('различает варианты стилей', () => {
    const primary = mount(UiButton).classes();
    const secondary = mount(UiButton, { props: { variant: 'secondary' } }).classes();
    const ghost = mount(UiButton, { props: { variant: 'ghost' } }).classes();

    expect(primary).toHaveLength(1);
    expect(secondary).toHaveLength(1);
    expect(primary).not.toEqual(secondary);
    expect(secondary).not.toEqual(ghost);
  });

  it('блокирует кнопку при disabled и loading', () => {
    const disabled = mount(UiButton, { props: { disabled: true } });
    const loading = mount(UiButton, { props: { loading: true } });

    expect(disabled.attributes('disabled')).toBeDefined();
    expect(loading.attributes('disabled')).toBeDefined();
    expect(loading.attributes('aria-busy')).toBe('true');
    expect(disabled.attributes('aria-busy')).toBeUndefined();
  });

  it('добавляет класс для растянутой кнопки', () => {
    const normal = mount(UiButton).classes();
    const block = mount(UiButton, { props: { block: true } }).classes();

    expect(block).toHaveLength(normal.length + 1);
  });
});
