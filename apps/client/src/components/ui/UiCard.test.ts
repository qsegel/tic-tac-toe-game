import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import UiCard from './UiCard.vue';

describe('UiCard', () => {
  it('рендерит содержимое в section', () => {
    const wrapper = mount(UiCard, { slots: { default: '<p>Комната</p>' } });

    expect(wrapper.element.tagName).toBe('SECTION');
    expect(wrapper.find('p').text()).toBe('Комната');
    expect(wrapper.classes()).toHaveLength(1);
  });

  it('мержит внешний класс модификатора', () => {
    const wrapper = mount(UiCard, { attrs: { class: 'join-card' } });

    expect(wrapper.classes()).toContain('join-card');
    expect(wrapper.classes()).toHaveLength(2);
  });
});
