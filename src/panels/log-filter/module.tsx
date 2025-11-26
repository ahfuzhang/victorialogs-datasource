import React, { useEffect, useMemo, useState } from 'react';

import { PanelPlugin, type PanelProps, type StandardEditorProps } from '@grafana/data';
import { Select, TextArea } from '@grafana/ui';
import { getBackendSrv } from '@grafana/runtime';

interface LogFilterOptions {
  yaml: string;
}

const LogFilterPanel: React.FC<PanelProps<LogFilterOptions>> = ({ height, timeRange, data }) => {
  const [streamFilters, setStreamFilters] = useState([
    { name: '', operator: '=', value: '' },
    { name: '', operator: '=', value: '' },
  ]);

  const [demoOption, setDemoOption] = useState<string | null>(null);
  const controlStyle: React.CSSProperties = { height: '32px', padding: '4px 8px' };
  const fieldOptions = ['', '_stream_id', 'namespace', 'pod'];
  const operatorOptions = ['=', '!=', '=~', '!~'];

  const on_operator_change = (select_dom: HTMLSelectElement) => {
    // eslint-disable-next-line no-console
    console.log('operator changed', select_dom.options[select_dom.selectedIndex].text);
    let node = select_dom.previousElementSibling;
    let hiddenInput = null;
    while (node) {
        if (node.tagName === 'INPUT' && node.type === 'hidden') {
            hiddenInput = node;
            break;
        }
        node = node.previousElementSibling;
    }
    if (!hiddenInput){
      console.log('not found prev <input type=hidden/>')
      return
    }
    //console.log(hiddenInput);
    const op = select_dom.options[select_dom.selectedIndex].value;
    switch (op){
      case '=':
      case '!=':
          //
          console.log(hiddenInput.value);
          break;
    }
  };

  const on_stream_field_names_response = (resp: any) => {
    const textarea = document.getElementById('response_data') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.value = JSON.stringify(resp, null, 2);
    }
    const container = document.getElementById('stream_filter_container');
    if (!container) {
      console.log('not found stream_filter_container');
      return;
    }
    if (Array.isArray(resp?.values)) {
      resp.values.forEach((item: any) => {
        // eslint-disable-next-line no-console
        console.log(item?.value, item?.hits);
        const wrapper = document.createElement('div');

        const valueText = document.createElement('span');
        valueText.innerHTML = `${item?.value ?? ''} `;

        const hiddenValue = document.createElement('input');
        hiddenValue.type = 'hidden';
        hiddenValue.value = item?.value ?? '';

        const hitsText = document.createElement('span');
        hitsText.style.color = 'gray';
        hitsText.textContent = `(hits: ${item?.hits ?? ''})`;

        const select = document.createElement('select');
        select.style.height = '32px';
        select.style.padding = '4px 8px';
        select.style.marginRight = '8px';
        select.dataset.operatorSelect = 'true';

        const options = [
          { value: '', label: '' },
          { value: '=', label: '= (equal)' },
          { value: '!=', label: '!= (not equal)' },
          { value: '=~', label: '=~ (regexp match)' },
          { value: '!~', label: '!~ (not match)' },
        ];

        options.forEach(opt => {
          const optionEl = document.createElement('option');
          optionEl.value = opt.value;
          optionEl.text = opt.label;
          select.appendChild(optionEl);
        });

        const br = document.createElement('br');

        wrapper.appendChild(valueText);
        wrapper.appendChild(hiddenValue);
        wrapper.appendChild(hitsText);
        wrapper.appendChild(select);
        wrapper.appendChild(br);

        container.prepend(wrapper);
      });
    }
  };

  const onClick = () => {
    window.alert('1');
  };

  useEffect(() => {
    (window as any).on_operator_change = on_operator_change;
    return () => {
      delete (window as any).on_operator_change;
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target && target.tagName === 'SELECT' && (target as HTMLSelectElement).dataset.operatorSelect === 'true') {
        on_operator_change(target as HTMLSelectElement);
      }
    };

    const container = document.getElementById('stream_filter_container');
    container?.addEventListener('change', handler, true);

    return () => {
      container?.removeEventListener('change', handler, true);
    };
  }, []);

  useEffect(() => {
    const fetchFields = async () => {
      let uid =
        data?.request?.request?.targets?.[0]?.datasource?.uid ??
        data?.request?.targets?.[0]?.datasource?.uid ??
        (window as any)?.__grafanaSceneContext?.meta?.data?.request?.targets?.[0]?.datasource?.uid ??
        (window as any)?.__grafana_data?.request?.targets?.[0]?.datasource?.uid;

      if (!uid) {
        try {
          const list = await getBackendSrv().get('/api/datasources');
          uid = list?.find?.((ds: any) => ds.type === 'victoriametrics-logs-datasource')?.uid;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('stream_field_names: failed to list datasources', err);
        }
      }

      if (!uid) {
        // eslint-disable-next-line no-console
        console.error('stream_field_names: datasource uid not found');
        return;
      }

      const now = Date.now();
      const start = timeRange?.from?.valueOf() ?? now;
      const end = timeRange?.to?.valueOf() ?? now;

      const path = `/api/datasources/uid/${uid}/resources/select/logsql/stream_field_names`;
      const payload = {
        query: '*',
        //start: String(start*1000),
        //end: String(end*1000),
        start: '',
        end: '',
        limit: String(50),
      };

      try {
        const resp = await getBackendSrv().post(path, payload);
        // eslint-disable-next-line no-console
        console.log('stream_field_names', resp);
        on_stream_field_names_response(resp);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('stream_field_names error', err);
      }
    };

    fetchFields();
  }, [data, timeRange]);

  const onChange = (index: number, key: 'name' | 'operator' | 'value', newValue: string) => {
    setStreamFilters(prev => prev.map((item, i) => (i === index ? { ...item, [key]: newValue } : item)));
  };

  return (
    <div style={{ height, padding: '16px', overflow: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }} border={0}>
        <tbody>
          <tr>
            <td rowSpan={2} style={{ verticalAlign: 'top', paddingRight: '12px', whiteSpace: 'nowrap' }}>
              stream filter
            </td>
            <td id="stream_filter_container" style={{ paddingBottom: '8px' }}>
              <select
                name="stream_field_1_name"
                value={streamFilters[0].name}
                onChange={e => onChange(0, 'name', e.currentTarget.value)}
                style={{ ...controlStyle, marginRight: '8px' }}
              >
                {fieldOptions.map(option => (
                  <option key={`stream-1-name-${option}`} value={option}>
                    {option || 'select field'}
                  </option>
                ))}
              </select>
              <select
                name="stream_field_1_operator"
                value={streamFilters[0].operator}
                onChange={e => onChange(0, 'operator', e.currentTarget.value)}
                style={{ ...controlStyle, marginRight: '8px' }}
              >
                {operatorOptions.map(option => (
                  <option key={`stream-1-operator-${option}`} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <input
                type="text"
                name="stream_field_1_value"
                value={streamFilters[0].value}
                onChange={e => onChange(0, 'value', e.currentTarget.value)}
                style={controlStyle}
              />
            </td>
          </tr>
          <tr>
            <td style={{ paddingBottom: '8px' }}>
              <select
                name="stream_field_2_name"
                value={streamFilters[1].name}
                onChange={e => onChange(1, 'name', e.currentTarget.value)}
                style={{ ...controlStyle, marginRight: '8px' }}
              >
                {fieldOptions.map(option => (
                  <option key={`stream-2-name-${option}`} value={option}>
                    {option || 'select field'}
                  </option>
                ))}
              </select>
              <select
                name="stream_field_2_operator"
                value={streamFilters[1].operator}
                onChange={e => onChange(1, 'operator', e.currentTarget.value)}
                style={{ ...controlStyle, marginRight: '8px' }}
              >
                {operatorOptions.map(option => (
                  <option key={`stream-2-operator-${option}`} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <input
                type="text"
                name="stream_field_2_value"
                value={streamFilters[1].value}
                onChange={e => onChange(1, 'value', e.currentTarget.value)}
                style={controlStyle}
              />
            </td>
          </tr>
          <tr>
            <td style={{ padding: '4px 12px 4px 0', whiteSpace: 'nowrap' }}>fields</td>
            <td style={{ padding: '4px 0' }}>empty</td>
          </tr>
          <tr>
            <td style={{ padding: '4px 12px 4px 0', whiteSpace: 'nowrap' }}>query options</td>
            <td style={{ padding: '4px 0' }}>empty</td>
          </tr>
          <tr>
            <td style={{ padding: '4px 12px 4px 0', whiteSpace: 'nowrap' }}>output options</td>
            <td style={{ padding: '4px 0' }}>empty</td>
          </tr>
          <tr>
            <td colSpan={2} style={{ textAlign: 'center', paddingTop: '12px' }}>
              <input type="button" value="Query" onClick={onClick} />
            </td>
          </tr>
          <tr>
            <td colSpan={2} style={{ paddingTop: '8px' }}>
              <textarea id="response_data" style={{ width: '100%', height: '160px' }} />
            </td>
          </tr>
          <tr>
            <td colSpan={2} style={{ paddingTop: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Select
                  width={24}
                  placeholder="Pick one"
                  options={[
                    { label: 'Alpha', value: 'alpha' },
                    { label: 'Beta', value: 'beta' },
                    { label: 'Gamma', value: 'gamma' },
                    { label: 'Delta', value: 'delta' },
                  ]}
                  value={demoOption}
                  onChange={v => setDemoOption(v.value ?? null)}
                />
                <span style={{ color: '#888' }}>Selected: {demoOption ?? '(none)'}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

const YamlEditor: React.FC<StandardEditorProps<string, any, any>> = ({ value, onChange }) => {
  const rows = useMemo(() => Math.max(10, (value?.split('\n').length ?? 0) + 4), [value]);

  return (
    <TextArea
      aria-label="Log filter YAML"
      rows={rows}
      placeholder="Enter YAML configuration"
      value={value ?? ''}
      onChange={event => onChange(event.currentTarget.value)}
    />
  );
};

export const plugin = new PanelPlugin<LogFilterOptions>(LogFilterPanel).setPanelOptions(builder =>
  builder.addCustomEditor({
    id: 'yaml',
    path: 'yaml',
    name: 'YAML config',
    description: 'YAML used to configure the LogFilter panel.',
    editor: YamlEditor,
    defaultValue: '',
  })
);
