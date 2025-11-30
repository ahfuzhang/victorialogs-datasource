import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PanelPlugin, type PanelProps, type StandardEditorProps, type TimeRange } from '@grafana/data';
import { Select, TextArea } from '@grafana/ui';
import { getBackendSrv } from '@grafana/runtime';

interface LogFilterOptions {
  yaml: string;
}

type Option = { label: string; value: string };
type Filter = { operator: string; value: string };

type StringBuilder = {
  append: (text: string) => StringBuilder;
  toString: () => string;
  clear: () => void;
};

const createStringBuilder = (initial = ''): StringBuilder => {
  const parts: string[] = initial ? [initial] : [];
  return {
    append(text: string) {
      parts.push(text);
      return this;
    },
    toString() {
      return parts.join('');
    },
    clear() {
      parts.length = 0;
    },
  };
};

const sysFields: Record<string, null> = {
  _msg: null,
  _stream: null,
  _stream_id: null,
  _time: null,
};

const LogFilterPanel: React.FC<PanelProps<LogFilterOptions>> = ({ height, timeRange, data }) => {
  const [demoOption, setDemoOption] = useState<string | null>(null);
  const [fieldSelectorDynamicValue, setFieldSelectorDynamicValue] = useState<string | null>(null);
  const [fieldSelectorDynamicOptions, setFieldSelectorDynamicOptions] = useState<Option[]>([]);
  const [fieldOperatorDynamicValue, setFieldOperatorDynamicValue] = useState<string | null>(null);
  const [fieldOperatorDynamicOptions] = useState<Option[]>([]);
  const [datasourceUid, setDatasourceUid] = useState<string | null>(null);
  const [filterByStreamFields, setFilterByStreamFields] = useState<boolean>(true);
  const timeRangeRef = useRef<TimeRange | undefined>(timeRange);
  const valueSelectRoots = useMemo(() => new WeakMap<HTMLElement, Root>(), []);
  const streamFieldMapRef = useRef<Record<string, null>>({});
  const fieldMapRef = useRef<Record<string, any>>({});
  const fieldsLastTimeRef = useRef<Record<string, null>>({});
  const streamFiltersRef = useRef<Record<string, Filter>>({});
  const msgFiltersRef = useRef<Record<string, Filter>>({});

  // 根据几个全局的 map, 生成 logsQL 语句
  const generateLogsQL = () => {
    const logsql = document.getElementById('logsql') as HTMLTextAreaElement | null;
    if (!logsql) {
      return;
    }
    const sb = createStringBuilder();
    const startStr = timeRangeRef.current?.from?.toISOString();
    const endStr = timeRangeRef.current?.to?.toISOString();
    if (startStr && endStr) {
      sb.append('_time:[');
      sb.append(startStr);
      sb.append(', ');
      sb.append(endStr);
      sb.append('] ');
    }
    const streamFilters = streamFiltersRef.current;
    if (Object.keys(streamFilters).length > 0) {
      sb.append('{');
      let isFirst = true;
      for (const k in streamFilters) {
        if (isFirst) {
          isFirst = false;
        } else {
          sb.append(',');
        }
        sb.append(k);
        sb.append(streamFilters[k].operator);
        sb.append(JSON.stringify(streamFilters[k].value ?? ''));
      }
      sb.append('} ');
    }
    if ('_msg' in msgFiltersRef.current) {
      const v = msgFiltersRef.current['_msg'];
      if (v.operator.length > 0 && v.value.length > 0) {
        sb.append('_msg');
        sb.append(v.operator);
        sb.append(JSON.stringify(v.value ?? ''));
        sb.append(' ');
      }
    }
    logsql.value = sb.toString();
  };
  const getFieldsByStreamFields = (streamField?: string, operator?: string, value?: string | null) => {
    // const textarea = document.getElementById('response_data') as HTMLTextAreaElement | null;
    // if (textarea) {
    //   const text = `${streamField ?? ''} ${operator ?? ''} ${value ?? ''}`.trim();
    //   textarea.value = text;
    // }
    const m = streamFiltersRef.current;
    if (m && streamField) {
      // 记录下修改后的 stream filter
      m[streamField] = { operator: operator ?? '', value: value ?? '' };
      generateLogsQL();
      loadFieldNamesByStreamFields();
    }
  };

  // 猜测是定义了一个控件
  const ValueSelect: React.FC<{
    options: Option[];
    operator?: string;
    streamField?: string;
    selectId: string;
    placeholder?: string;
    onInput?: (val: string | undefined | null) => void | Promise<void>;
  }> = ({ options, operator, streamField, selectId, placeholder, onInput }) => {
    const [localOptions, setLocalOptions] = useState<Option[]>(options);
    useEffect(() => {
      setLocalOptions(options);
    }, [options]);

    return (
      <Select
        width={40}
        allowCustomValue
        inputId={selectId}
        name={selectId}
        placeholder={placeholder ?? 'type or select'}
        options={localOptions}
        onChange={(v) => {
          getFieldsByStreamFields(streamField, operator, v.value);
        }}
        onInputChange={(inputValue, actionMeta: any) => {
          if (actionMeta?.action === 'input-change') {
            onInput?.(inputValue);
          }
        }}
      />
    );
  };

  // 选择的时间范围变更的时候，响应这个事件
  const onTimeRangeChange = (tr?: TimeRange) => {
    // const startStr = tr?.from?.toISOString();
    // const endStr = tr?.to?.toISOString();
    // // placeholder: react to time range change without resetting form state
    // console.info('time range changed', startStr, endStr);
    generateLogsQL();
  };

  const onDynamicFieldSelectChange = (value?: string | null) => {
    setFieldSelectorDynamicValue(value ?? null);
  };

  const onDynamicFieldOperatorChange = (value?: string | null) => {
    setFieldOperatorDynamicValue(value ?? null);
  };

  const onFilterByStreamFieldsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFilterByStreamFields(event.currentTarget.checked);
    // if (!event.currentTarget.checked){
    //   const opts: Option[] = Object.keys(fieldsLastTimeRef.current).map((k: string) => ({ label: k, value: k }));
    //   setFieldSelectorDynamicOptions(opts);
    //   setFieldSelectorDynamicValue(null);
    //   return;
    // }
    loadFieldNamesByStreamFields();
  };

  const onFieldOperatorChange = (value?: string | null) => {
    const op = value ?? '';
    const m = msgFiltersRef.current;
    if ('_msg' in m) {
      m['_msg'].operator = op;
    } else {
      m['_msg'] = { operator: op, value: '' };
    }
    generateLogsQL();
  };

  const onFieldValueBlur = (val: string) => {
    const m = msgFiltersRef.current;
    if ('_msg' in m) {
      m['_msg'].value = val ?? '';
    } else {
      m['_msg'] = { operator: ':~', value: val ?? '' };
    }
    generateLogsQL();
  };

  const onLogsqlCopy = () => {
    const textarea = document.getElementById('logsql') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.select();
      document.execCommand('copy');
    }
  };

  const onLogsqlTest = () => {
    const respTextarea = document.getElementById('response_data') as HTMLTextAreaElement | null;
    const logsqlEl = document.getElementById('logsql') as HTMLTextAreaElement | null;
    const startTs = timeRangeRef.current?.from?.valueOf();
    const endTs = timeRangeRef.current?.to?.valueOf();
    const query = logsqlEl?.value ?? '';

    if (!startTs || !endTs || !query || !datasourceUid) {
      if (respTextarea) {
        respTextarea.value = 'Missing time range, query, or datasource UID';
      }
      return;
    }

    const body = {
      queries: [
        {
          //refId: 'log-volume-A',
          datasource: { type: 'victoriametrics-logs-datasource', uid: datasourceUid },
          //editorMode: 'code',
          expr: query,
          queryType: 'hits',
          maxLines: 1000,
          step: '1d',
          // fields: [],
          // supportingQueryType: 'logsVolume',
          // legendFormat: '',
          // datasourceId: 0,
          // intervalMs: 0,
          // maxDataPoints: 0,
        },
      ],
      from: String(startTs), // 单位确实是毫秒
      to: String(endTs),
    };

    getBackendSrv()
      .post(`/api/ds/query?ds_type=victoriametrics-logs-datasource&requestId=logsql_test`, body)
      .then((resp) => {
        if (respTextarea) {
          respTextarea.value = JSON.stringify(resp, null, 2);
        }
      })
      .catch((err) => {
        if (respTextarea) {
          respTextarea.value = String(err);
        }
      });
  };

  // 当输入正则表达式变化时
  const onStreamFieldValueBlur = async (streamField: string, operator: string, val: string) => {
    const m = streamFiltersRef.current;
    if (streamField) {
      m[streamField] = { operator: operator ?? '', value: val ?? '' };
      generateLogsQL();
      await loadFieldNamesByStreamFields();
    }
    // const textarea = document.getElementById('response_data') as HTMLTextAreaElement | null;
    // if (textarea) {
    //   textarea.value = val;
    // }
  };

  const loadFieldNamesByStreamFields = async () => {
    //const textarea = document.getElementById('response_data') as HTMLTextAreaElement | null;
    const uid = await resolveDatasourceUid();
    if (!uid) {
      // eslint-disable-next-line no-console
      console.error('loadFFieldNamesByStreamFields: datasource uid not found');
      return;
    }
    const chkUseStreamFilter = document.getElementById('chkUseStreamFilter') as HTMLInputElement | null;
    const useStreamFilter = chkUseStreamFilter?.checked ?? false;
    if (!useStreamFilter) {
      const opts: Option[] = Object.keys(fieldsLastTimeRef.current)
        .sort()
        .map((k: string) => ({ label: k, value: k }));
      setFieldSelectorDynamicOptions(opts);
      setFieldSelectorDynamicValue(null);
      return;
    }
    try {
      const operatorMap: Record<string, string> = {
        '=': ':xxx',
        '!=': ':!xxx',
        '=~': ':~xxx',
        '!~': ':!~xxx',
      };
      const filters = streamFiltersRef.current;
      const expressions: string[] = [];

      if (Object.keys(filters).length === 0) {
        expressions.push('*');
      } else {
        Object.keys(filters).forEach((key) => {
          const op = filters[key]?.operator ?? '';
          const val = filters[key]?.value ?? '';
          const mapped = operatorMap[op] ?? op;
          if (mapped.includes('xxx')) {
            expressions.push(`${key}${mapped.replace('xxx', JSON.stringify(val ?? ''))}`);
          } else {
            expressions.push(`${key}${mapped}${val}`);
          }
        });
      }
      const queryExpr = expressions.join(',');
      const resp = await getBackendSrv().post(`/api/datasources/uid/${uid}/resources/select/logsql/field_names`, {
        query: queryExpr,
        start: '',
        end: '',
        limit: '50',
      });
      // if (textarea) {
      //   textarea.value = JSON.stringify(resp, null, 2);
      // }
      const keys = Array.isArray(resp?.values)
        ? resp.values
            .map((item: any) => item?.value ?? '')
            .filter((k: string) => k !== ''&&!(k in sysFields)&&!(k in streamFieldMapRef.current))
            .sort()
        : [];
      //  && !(k in streamFieldMapRef.current)  
      //  && !(k in sysFields)
      // todo: 这里应该过滤掉系统字段
      const opts: Option[] = keys.map((k: string) => ({ label: k, value: k }));
      setFieldSelectorDynamicOptions(opts);
      setFieldSelectorDynamicValue(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('loadFFieldNamesByStreamFields error', err);
      // if (textarea) {
      //   textarea.value = String(err);
      // }
    }
  };

  // 查询当前的数据源 id
  const resolveDatasourceUid = async (): Promise<string | null> => {
    const targets = (data as any)?.request?.targets;
    let uid =
      datasourceUid ??
      targets?.[0]?.datasource?.uid ??
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

  const renderValueSelectForWrapper = (
    wrapper: HTMLElement,
    opts: Option[],
    operator?: string,
    streamField?: string,
    placeholder?: string
  ) => {
    const selectId = streamField ? `stream-value-${streamField}` : 'stream-value-select';
    let root = valueSelectRoots.get(wrapper);
    if (!root) {
      root = createRoot(wrapper);
      valueSelectRoots.set(wrapper, root);
    }

    root.render(
      <ValueSelect
        options={opts}
        operator={operator}
        streamField={streamField}
        selectId={selectId}
        placeholder={placeholder}
        onInput={(inputValue) => streamFieldOnValueInputChange(wrapper, inputValue, operator, streamField)}
      />
    );
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
      // if (textarea) {
      //   textarea.value = JSON.stringify(resp);
      // }

      if (source && source instanceof HTMLElement) {
        const options =
          Array.isArray(resp?.values) && resp.values.length
            ? resp.values.map((item: any) => ({
                label: '(' + String(item.hits) + ')' + item?.value,
                value: item?.value,
              }))
            : [];
        renderValueSelectForWrapper(source, options, operator, streamField);
        if (textarea) {
          textarea.value = JSON.stringify(options);
        }
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

    const targetCell = valueCell ?? (selectEl.parentElement?.nextElementSibling as HTMLElement | null);
    if (!targetCell) {
      return;
    }

    switch (operator) {
      case '':
        while (targetCell.firstChild) {
          targetCell.removeChild(targetCell.firstChild);
        }
        if (streamField) {
          delete streamFiltersRef.current[streamField];
        }
        break;
      case '=':
      case '!=':
        if (!streamField) {
          return;
        }
        await showStreamFieldValueSelector(targetCell, operator, streamField);
        break;
      case '=~':
      case '!~':
        while (targetCell.firstChild) {
          targetCell.removeChild(targetCell.firstChild);
        }
        {
          const root = createRoot(targetCell);
          root.render(
            <input
              type="text"
              style={{ width: '400px', height: '32px', padding: '4px 8px' }}
              placeholder="enter value"
              onBlur={(e) => {
                onStreamFieldValueBlur(streamField, operator, e.currentTarget.value);
              }}
            />
          );
        }
        break;
      default:
        alert('not support operator:' + operator);
        break;
    }
    loadFieldNamesByStreamFields();
  };

  const showStreamFieldValueSelector = async (targetCell: HTMLElement, operator?: string, streamField?: string) => {
    while (targetCell.firstChild) {
      targetCell.removeChild(targetCell.firstChild);
    }

    const wrapper = document.createElement('div');
    wrapper.dataset.streamValueSelect = 'true';
    targetCell.appendChild(wrapper);

    renderValueSelectForWrapper(wrapper, [], operator, streamField, 'loading...');

    const uid = await resolveDatasourceUid();
    if (!uid) {
      // eslint-disable-next-line no-console
      console.error('stream_field_values: datasource uid not found');
      return;
    }

    try {
      const resp = await getBackendSrv().post(
        `/api/datasources/uid/${uid}/resources/select/logsql/stream_field_values`,
        {
          field: streamField,
          query: '*',
          start: '',
          end: '',
          limit: '50',
        }
      );
      const options =
        Array.isArray(resp?.values) && resp.values.length
          ? resp.values.map((item: any) => ({ label: item?.value ?? '', value: item?.value ?? '' }))
          : [];
      renderValueSelectForWrapper(wrapper, options, operator, streamField);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('stream_field_values error', err);
    }
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
    nameTd.style.width = '220px';
    nameTd.innerHTML = `
      <span style="display:inline-block;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:220px;text-align:right;" title="hits:${hits}">
        ${stream_field_name ?? ''}:
      </span>`;

    const operatorTd = document.createElement('td');
    const valueTd = document.createElement('td');
    const select = document.createElement('select');
    select.style.height = '32px';
    select.style.width = '180px';
    select.style.padding = '4px 8px';
    select.style.marginRight = '8px';
    [
      { value: '', label: 'empty' },
      { value: '=', label: '= (equal)' },
      { value: '!=', label: '!= (not equal)' },
      { value: '=~', label: '=~ (regexp match)' },
      { value: '!~', label: '!~ (not match)' },
    ].forEach((opt) => {
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

  // run once on mount; avoid re-running/clearing form state on time range change
  useEffect(() => {
    const fetchSreamFields = async () => {
      const uid = await resolveDatasourceUid();

      if (!uid) {
        // eslint-disable-next-line no-console
        console.error('stream_field_names: datasource uid not found');
        return;
      }

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
        //alert(1);
        on_stream_field_names_response(resp);
        // 查询到 stream field 后，再调用 fetchFields();
        console.info('stream_field_names:', resp);
        fetchFields(resp);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('stream_field_names error', err);
      }
    };

    // 拉取普通的 field 的 name
    const fetchFields = async (streamFields: any) => {
      //alert(2);
      console.info('stream_field_names:', streamFields);
      const uid = await resolveDatasourceUid();
      if (!uid) {
        // eslint-disable-next-line no-console
        //alert(3);
        console.error('field_names: datasource uid not found');
        return;
      }

      try {
        const resp = await getBackendSrv().post(`/api/datasources/uid/${uid}/resources/select/logsql/field_names`, {
          query: '*',
          start: '',
          end: '',
          limit: '50',
        });
        handleFieldNamesResponse(streamFields, resp);
      } catch (err) {
        // eslint-disable-next-line no-console
        //alert(4);
        console.error('field_names error', err);
      }
    };

    fetchSreamFields();
  }, []);

  // keep latest timeRange in ref without resetting UI state
  useEffect(() => {
    timeRangeRef.current = timeRange;
    onTimeRangeChange(timeRange);
  }, [timeRange]);

  const handleFieldNamesResponse = (streamFields: any, resp: any) => {
    //alert(5);
    const textarea = document.getElementById('response_data') as HTMLTextAreaElement | null;
    if (!textarea) {
      return;
    }
    textarea.value += '\n\n' + JSON.stringify(resp);
    console.info('stream_field_names:', streamFields);
    const streamFieldMap: Record<string, null> = {};
    if (Array.isArray(streamFields?.values)) {
      streamFields.values.forEach((item: any) => {
        const key = item?.value ?? '';
        if (key !== '') {
          streamFieldMap[key] = null;
        }
      });
    }
    streamFieldMapRef.current = streamFieldMap;
    textarea.value += '\n\n' + JSON.stringify(streamFieldMap);
    //

    const fieldMap: Record<string, null> = {};
    if (Array.isArray(resp?.values)) {
      resp.values.forEach((item: any) => {
        const key = item?.value ?? '';
        if (key === '') {
          return;
        }
        if (key in sysFields) {
          return;
        }
        if (key in streamFieldMap) {
          return;
        }
        fieldMap[key] = null;
        fieldsLastTimeRef.current[key] = null; // 记录第一次读到的字段，减少后续的加载
      });
    }
    fieldMapRef.current = fieldMap;
    textarea.value += '\n\n' + JSON.stringify(fieldMap);
    // if (textarea) {
    //   textarea.value = JSON.stringify(fieldMap);
    // }
    showFieldSelector();
  };

  // 展示 field 的选择框
  const showFieldSelector = () => {
    const keys = Object.keys(fieldMapRef.current ?? {}).sort();
    const opts: Option[] = keys.map((k) => ({ label: k, value: k }));
    setFieldSelectorDynamicOptions(opts);
    setFieldSelectorDynamicValue(null);
  };

  return (
    <div style={{ height, padding: '16px', overflow: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }} border={0}>
        <tbody>
          <tr>
            <td>
              <table style={{ borderCollapse: 'collapse', width: '100%' }} border={1}>
                <tbody>
                  <tr>
                    <td style={{ verticalAlign: 'top', paddingRight: '12px', whiteSpace: 'nowrap' }} width="100">
                      stream fields:
                    </td>
                    <td id="stream_filter_container" style={{ paddingBottom: '8px' }}>
                      <table style={{ width: '500' }}>
                        <tbody id="stream_filter_tbody"></tbody>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 12px 4px 0', whiteSpace: 'nowrap' }}>fields:</td>
                    <td style={{ padding: '4px 0' }}>
                      <table style={{ width: '500' }}>
                        <tbody id="field_filter_tbody">
                          <tr>
                            <td colSpan={2}>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                  type="checkbox"
                                  checked={filterByStreamFields}
                                  id="chkUseStreamFilter"
                                  onChange={onFilterByStreamFieldsChange}
                                />
                                filter by stream fields
                              </label>
                            </td>
                          </tr>
                          <tr>
                            <td>
                              <Select
                                width={25}
                                options={fieldSelectorDynamicOptions}
                                allowCustomValue
                                placeholder="Select field"
                                id="selForFieldNames"
                                value={fieldSelectorDynamicOptions.find((o) => o.value === fieldSelectorDynamicValue)}
                                onChange={(v) => onDynamicFieldSelectChange(v.value)}
                              />
                            </td>
                            <td>
                              <Select
                                width={25}
                                options={fieldOperatorDynamicOptions}
                                allowCustomValue={false}
                                placeholder="Choose operator"
                                value={fieldOperatorDynamicOptions.find((o) => o.value === fieldOperatorDynamicValue)}
                                onChange={(v) => onDynamicFieldOperatorChange(v.value)}
                              />
                            </td>
                            <td>
                              <TextArea placeholder="input field value" />
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 12px 4px 0', whiteSpace: 'nowrap' }}>message:</td>
                    <td style={{ padding: '4px 0' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', maxWidth: '500px' }}>
                        <Select
                          width={30}
                          options={[
                            { label: ':~ (regexp match)', value: ':~' },
                            { label: ':!~ (not match)', value: ':!~' },
                          ]}
                          allowCustomValue={false}
                          onChange={(v) => onFieldOperatorChange(v.value)}
                          placeholder="op"
                        />
                        <input
                          type="text"
                          width={40}
                          style={{ flex: 1, height: '32px', padding: '4px 8px' }}
                          placeholder="enter value"
                          onBlur={(e) => onFieldValueBlur(e.currentTarget.value)}
                        />
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 12px 4px 0', whiteSpace: 'nowrap' }}>Full text search:</td>
                    <td style={{ padding: '4px 0' }}>
                      <textarea></textarea>
                    </td>
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
                          onChange={(v) => setDemoOption(v.value ?? null)}
                        />
                        <span style={{ color: '#888' }}>Selected: {demoOption ?? '(none)'}</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
            <td width="400" valign="top">
              <TextArea
                aria-label="LogSQL output"
                rows={10}
                placeholder="LogSQL preview"
                defaultValue=""
                style={{ width: '100%' }}
                id="logsql"
              />
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px' }}>
                <button style={{ padding: '8px 16px' }} onClick={onLogsqlCopy}>
                  Copy LogSQL
                </button>
                <button style={{ padding: '8px 16px', marginLeft: '12px' }} onClick={onLogsqlTest}>
                  Test LogsQL
                </button>
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
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
};

export const plugin = new PanelPlugin<LogFilterOptions>(LogFilterPanel).setPanelOptions((builder) =>
  builder.addCustomEditor({
    id: 'yaml',
    path: 'yaml',
    name: 'YAML config',
    description: 'YAML used to configure the LogFilter panel.',
    editor: YamlEditor,
    defaultValue: '',
  })
);
