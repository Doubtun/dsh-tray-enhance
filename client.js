window.__ModuleLoader__.load({
  id: 'dsh-tray-enhance',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect } = React;

    const NS = 'tray-enhance';

    const dict = {
      en: {
        languageLabel: 'Menu language',
        languageAuto: 'Follow the application',
        languageZh: 'Chinese',
        languageEn: 'English',
        unavailable: 'This setting is not available yet.',
      },
      zh: {
        languageLabel: '菜单语言',
        languageAuto: '跟随应用语言',
        languageZh: '中文',
        languageEn: 'English',
        unavailable: '此设置暂不可用。',
      },
    };

    const css = `.tray-enhance-config{display:flex;flex-direction:column;gap:18px;padding:4px 0}.tray-enhance-config .row{display:flex;flex-direction:column;gap:6px}.tray-enhance-config .label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px}.tray-enhance-config select{appearance:auto;width:100%;max-width:320px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:7px 10px;font-size:13px;line-height:18px;cursor:pointer}`;

    function ConfigForm(props) {
      const form = props.form;
      const [snapshot, setSnapshot] = useState(() => form.getSnapshot());
      useEffect(() => form.subscribe(() => setSnapshot(form.getSnapshot())), [form]);

      const t = props.t;
      if (snapshot.status !== 'ready') {
        return h('div', { className: 'tray-enhance-config' },
          h('div', { className: 'label' }, t('unavailable')));
      }
      const value = snapshot.value || { language: 'auto' };
      const disabled = !snapshot.writable;

      return h('div', { className: 'tray-enhance-config' },
        h('div', { className: 'row' },
          h('div', { className: 'label' }, t('languageLabel')),
          h('select', { value: value.language, disabled, onChange: (event) => form.set('language', event.currentTarget.value) },
            [
              ['auto', t('languageAuto')],
              ['zh', t('languageZh')],
              ['en', t('languageEn')],
            ].map(([value, text]) => h('option', { key: value, value }, text))),
        ),
      );
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dict), 'tray-enhance: dictionaries');
        const t = ctx.locale.bind(NS);
        const form = ctx.configForms.get('tray-enhance');

        const face = () => ({ t, form });

        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-tray-enhance',
          locale: NS,
          inject: face,
        }, ConfigForm));

        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = 'dsh-tray-enhance';
          tag.dataset.pluginCss = 'dsh-tray-enhance/config';
          tag.textContent = css;
          document.head.appendChild(tag);
          return () => tag.remove();
        }, 'tray-enhance: stylesheet');
      },
    };
  },
});
