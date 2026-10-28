import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import UiError from './UiError.vue';

describe('UiError', () => {
  it('показывает сообщение как alert', () => {
    const wrapper = mount(UiError, { props: { message: 'Комната не найдена' } });

    expect(wrapper.attributes('role')).toBe('alert');
    expect(wrapper.text()).toBe('Комната не найдена');
  });

  it('ничего не рендерит без сообщения', () => {
    expect(mount(UiError).find('p').exists()).toBe(false);
    expect(mount(UiError, { props: { message: null } }).find('p').exists()).toBe(false);
  });
});
