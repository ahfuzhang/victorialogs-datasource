import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { PanelPlugin, type PanelProps, type StandardEditorProps } from '@grafana/data';
import { Select, TextArea } from '@grafana/ui';
import { getBackendSrv } from '@grafana/runtime';

interface LogFilterOptions {
  yaml: string;
}

type Option = { label: string; value: string };

const ValueSelect: React.FC<{
  options: Option[];
  operator?: string;
  streamField?: string;
  selectId: string;
  onInput?: (val: string | undefined | null) => void;
}> = ({ options, operator, streamField, selectId, onInput }) => {
  const [localOptions, setLocalOptions] = useState<Option[]>(options);
  useEffect(() => {
    setLocalOptions(options);
  }, [options]);

  return (
    <Select
      width={24}
      allowCustomValue
      inputId={selectId}
      name={selectId}
      placeholder="type or select"
      options={localOptions}
      onChange={v => {
        const textarea = document.getElementById('response_data') as HTMLTextAreaElement | null;
        if (textarea) {
          const text = `${streamField ?? ''} ${operator ?? ''} ${v.value ?? ''}`.trim();
          textarea.value = text;
        }
      }}
      onInputChange={(inputValue, actionMeta: any) => {
        if (actionMeta?.action === 'input-change') {
          onInput?.(inputValue);
        }
      }}
    />
  );
};

const LogFilterPanel: React.FC<PanelProps<LogFilterOptions>> = ({ height, timeRange, data }) => {
  const [demoOption, setDemoOption] = useState<string | null>(null);
  const [datasourceUid, setDatasourceUid] = useState<string | null>(null);

  const resolveDatasourceUid = async (): Promise<string | null> => {
    let uid =
      datasourceUid ??
      data?.request?.request?.targets?.[0]?.datasource?.uid ??
      data?.request?.targets?.[0]?.datasource?.uid ??
      (window as any)?.__grafanaSceneContext?.meta?.data?.request?.targets?.[0]?.datasource?.uid ??
      (window as any)?.__grafana_data?.request?.targets?.[0]?.datasource?.uid;

    if (uid) {
      setDatasourceUid(uid);
      return uid;
    }

    try {
      const list = await getBackendSrv().get('/api/datasources');
      uid = list?.find?.((ds: any) => ds.type === 'victoriametrics-logs-datasource')?.uid;
      if (uid) {
        setDatasourceUid(uid);
        return uid;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('resolveDatasourceUid: failed to list datasources', err);
    }

    return null;
  };

  const streamFieldOnValueInputChange = async (
    source: HTMLElement | null,
    val: string | undefined | null,
    operator?: string,
    streamField?: string
  ) => {
    const textarea = document.getElementById('response_data') as HTMLTextAreaElement | null;
    // if (textarea) {
    //   const text = `${streamField ?? ''} ${operator ?? ''} ${val ?? ''}`.trim();
    //   textarea.value = text;
    // }

    if (!streamField) {
      return;
    }

    const uid = await resolveDatasourceUid();
    if (!uid) {
      // eslint-disable-next-line no-console
      console.error('stream_field_names: datasource uid not found for input change');
      return;
    }

    const path = `/api/datasources/uid/${uid}/resources/select/logsql/stream_field_values`;
    const payload = {
      field: streamField,
      query: `${streamField}:~\".*${val}.*\"`,
      limit: '50',
      start: '',
      end: '',
    };

    try {
      const resp = await getBackendSrv().post(path, payload);
      if (textarea) {
        textarea.value = JSON.stringify(resp);
      }

      // eslint-disable-next-line no-console
      console.log('stream_field_values input from', source, resp);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('stream_field_names input change error', err);
    }
  };

  const on_operator_change = async (selectEl: HTMLSelectElement, valueCell?: HTMLElement | null) => {
    // eslint-disable-next-line no-console
    const value = selectEl.value;
    console.log('onchange select', value);
    const textarea = document.getElementById('response_data') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.value = value;
    }
    let jsonData: any;
    try {
      jsonData = JSON.parse(value);
    } catch {
      return;
    }

    const operator = jsonData?.operator;
    const streamField = jsonData?.stream_field ?? jsonData?.stream_feild;

    if (!streamField || !(operator === '=' || operator === '!=')) {
      return;
    }

    const targetCell = valueCell ?? (selectEl.parentElement?.nextElementSibling as HTMLElement | null);
    if (!targetCell) {
      return;
    }

    while (targetCell.firstChild) {
      targetCell.removeChild(targetCell.firstChild);
    }

    const wrapper = document.createElement('div');
    wrapper.dataset.streamValueSelect = 'true';
    targetCell.appendChild(wrapper);

    const renderValueSelect = (opts: Option[], placeholder?: string, operatorParam?: string, streamFieldParam?: string) => {
      const root = createRoot(wrapper);
      const selectId = streamFieldParam ? `stream-value-${streamFieldParam}` : 'stream-value-select';
      root.render(
        <ValueSelect
          options={opts}
          operator={operatorParam}
          streamField={streamFieldParam}
          selectId={selectId}
          onInput={inputValue => streamFieldOnValueInputChange(wrapper, inputValue, operatorParam, streamFieldParam)}
        />
      );
    };

    renderValueSelect([], 'loading...', operator, streamField);

    const uid = await resolveDatasourceUid();
    if (!uid) {
      // eslint-disable-next-line no-console
      console.error('stream_field_values: datasource uid not found');
      return;
    }

    const path = `/api/datasources/uid/${uid}/resources/select/logsql/stream_field_values`;
    const payload = {
      field: streamField,
      query: '*',
      start: '',
      end: '',
      limit: '50',
    };

    getBackendSrv()
      .post(path, payload)
      .then(resp => {
        const options =
          Array.isArray(resp?.values) && resp.values.length
            ? resp.values.map((item: any) => ({ label: item?.value ?? '', value: item?.value ?? '' }))
            : [];
        renderValueSelect(options, undefined, operator, streamField);
      })
      .catch(err => {
        // eslint-disable-next-line no-console
        console.error('stream_field_values error', err);
      });
  };

  const each_stream_feild = (stream_field_name: string, hits: number) => {
    // eslint-disable-next-line no-console
    console.log('each_stream_feild', stream_field_name, hits);
    const tbody = document.getElementById('stream_filter_tbody') as HTMLTableSectionElement | null;
    if (!tbody) {
      return;
    }
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.style.width="220px"
    nameTd.innerHTML = `
      <span style="display:inline-block;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:220px;text-align:right;" title="hits:${hits}">
        ${stream_field_name ?? ''}:
      </span>`;

    const operatorTd = document.createElement('td');
    const valueTd = document.createElement('td');
    const select = document.createElement('select');
    select.style.height = '32px';
    select.style.padding = '4px 8px';
    select.style.marginRight = '8px';
    [
      { value: '', label: 'empty' },
      { value: '=', label: '= (equal)' },
      { value: '!=', label: '!= (not equal)' },
      { value: '=~', label: '=~ (regexp match)' },
      { value: '!~', label: '!~ (not match)' },
    ].forEach(opt => {
      const optionEl = document.createElement('option');
      optionEl.value = JSON.stringify({ stream_feild: stream_field_name, operator: opt.value });
      optionEl.text = opt.label;
      select.appendChild(optionEl);
    });
    select.addEventListener('change', () => on_operator_change(select, valueTd));
    operatorTd.appendChild(select);

    tr.appendChild(nameTd);
    tr.appendChild(operatorTd);
    tr.appendChild(valueTd);
    tbody.appendChild(tr);
  };

  // stream_field_names
  const on_stream_field_names_response = (resp: any) => {
    const textarea = document.getElementById('response_data') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.value = JSON.stringify(resp, null, 2);
    }
    const tbody = document.getElementById('stream_filter_tbody');
    if (!tbody) {
      console.log('not found stream_filter_tbody');
      return;
    }
    tbody.innerHTML = '';
    if (Array.isArray(resp?.values)) {
      resp.values.forEach((item: any) => {
        each_stream_feild(item?.value, item?.hits);
      });
    }
  };

  const onClick = () => {
    window.alert('1');
  };


  useEffect(() => {
    const fetchFields = async () => {
      const uid = await resolveDatasourceUid();

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
        limit: String(100),
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
    // 调用异步函数
    fetchFields();
  }, [data, timeRange]);


  return (
    <div style={{ height, padding: '16px', overflow: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }} border={0}>
        <tbody>
          <tr>
            <td rowSpan={2} style={{ verticalAlign: 'top', paddingRight: '12px', whiteSpace: 'nowrap' }} width="100">
              stream filter
            </td>
            <td id="stream_filter_container" style={{ paddingBottom: '8px' }}>
              <table style={{ width: '500' }}>
                <tbody id="stream_filter_tbody"></tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td style={{ paddingBottom: '8px' }}>
              todo
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
