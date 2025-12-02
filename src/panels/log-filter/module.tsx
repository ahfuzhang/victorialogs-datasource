import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PanelPlugin, type PanelProps, type StandardEditorProps, type TimeRange } from '@grafana/data';
import { Combobox, Select, TextArea } from '@grafana/ui';
import { getBackendSrv } from '@grafana/runtime';
import { locationService } from '@grafana/runtime';

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
  const [fieldSelectorDynamicValue, setFieldSelectorDynamicValue] = useState<string | null>(null);
  const [fieldSelectorDynamicOptions, setFieldSelectorDynamicOptions] = useState<Option[]>([]);
  const [fieldOperatorDynamicValue, setFieldOperatorDynamicValue] = useState<string | null>(null);
  const [fieldOperatorDynamicOptions] = useState<Option[]>([]);
  const [fieldValueDynamic, setFieldValueDynamic] = useState<string>('');
  const [fullTextSearch, setFullTextSearch] = useState<string>('');
  const [fullTextSearchOperator, setFullTextSearchOperator] = useState<string | null>(null);
  const [messageValue, setMessageValue] = useState<string>('');
  const [limitEnabled, setLimitEnabled] = useState<boolean>(true);
  const [limitValue, setLimitValue] = useState<string>('100');
  // useEffect(() => {
  //   alert(2);
  // }, []);

  const onFullTextSearchBlur = (val: string) => {
    const op = fullTextSearchOperator ?? '';
    const value = val ?? '';
    if (!op || !value) {
      return;
    }
    fulltextFiltersRef.current['fulltext'] = { operator: op, value };
    generateLogsQL();
  };

  useEffect(() => {
    generateLogsQL();
  }, [limitEnabled, limitValue]);
  const [testResult, setTestResult] = useState<string>('');
  const [testError, setTestError] = useState<string>('');
  const [datasourceUid, setDatasourceUid] = useState<string | null>(null);
  const defaultFieldOperatorOptions: Option[] = [
    { label: ':= (equal)', value: ':=xxx' },
    { label: ':i() (equal, ignore case)', value: ':i(xxx)' },
    { label: ':! (not equal)', value: ':!xxx' },
    { label: ':~ (regexp match)', value: ':~xxx' },
    { label: ':!~ (not match)', value: ':!~xxx' },
    { label: ':xxx* (prefix)', value: ':xxx*' },
    { label: ':*xxx* (substring)', value: ':*xxx*' },
    //{ label: 'in', value: 'in(xxx)' },
    { label: ':> (great)', value: ':>xxx' },
    { label: ':>= (great equal)', value: ':>=xxx' },
    { label: ':< (less)', value: ':<xxx' },
    { label: ':<= (less equal)', value: ':<=xxx' },
    // { label: 'range', value: ':range(a,b)' },
    // { label: 'string_range', value: ':string_range(a,b)' },
    // { label: ':le_field (less equal than a field)', value: ':le_field($field)' },
    // { label: ':eq_field (equal a field)', value: ':eq_field($field)' },
    // { label: ':lt_field (less than a field)', value: ':lt_field($field)' },
  ];
  const [filterByStreamFields, setFilterByStreamFields] = useState<boolean>(true);
  const timeRangeRef = useRef<TimeRange | undefined>(timeRange);
  const valueSelectRoots = useMemo(() => new WeakMap<HTMLElement, Root>(), []);
  const streamFieldMapRef = useRef<Record<string, null>>({});
  const fieldMapRef = useRef<Record<string, any>>({});
  const fieldsLastTimeRef = useRef<Record<string, null>>({});
  const streamFiltersRef = useRef<Record<string, Filter>>({});
  const fieldFiltersRef = useRef<Record<string, Filter>>({});
  const msgFiltersRef = useRef<Record<string, Filter>>({});
  const fulltextFiltersRef = useRef<Record<string, Filter>>({});

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
        sb.append(JSON.stringify(k));
        sb.append(streamFilters[k].operator);
        sb.append(JSON.stringify(streamFilters[k].value ?? ''));
      }
      sb.append('} ');
    }
    //
    const fieldFilters = fieldFiltersRef.current;
    for (const k in fieldFilters) {
      sb.append(JSON.stringify(k));
      const op = fieldFilters[k]?.operator ?? '';
      const val = fieldFilters[k]?.value ?? '';
      if (op.includes('xxx')) {
        sb.append(`${op.replace('xxx', JSON.stringify(val ?? ''))}`)
      } else {
        sb.append(op)
        sb.append(JSON.stringify(val ?? ''))
      }
      sb.append(' ')
    }
    //
    if ('_msg' in msgFiltersRef.current) {
      const v = msgFiltersRef.current['_msg'];
      if (v.operator.length > 0 && v.value.length > 0) {
        sb.append('_msg');
        sb.append(v.operator);
        sb.append(JSON.stringify(v.value ?? ''));
        sb.append(' ');
      }
    }
    //
    if ('fulltext' in fulltextFiltersRef.current) {
      const ft = fulltextFiltersRef.current['fulltext'];
      if (ft.operator.length > 0 && ft.value.length > 0) {
        let expr = '';
        if (ft.operator.includes('xxx')) {
          expr = ft.operator.replace(/xxx/g, JSON.stringify(ft.value ?? ''));
        } else {
          expr = `${ft.operator}${ft.value}`;
        }
        sb.append(expr);
        sb.append(' ');
      }
    }
    if (Object.keys(streamFilters).length == 0 && 
      Object.keys(fieldFilters).length == 0 && 
      Object.keys(msgFiltersRef.current).length == 0 && 
      Object.keys(fulltextFiltersRef.current).length == 0) {
        sb.append('* ');
    }
    if (limitEnabled) {
      const num = Number(limitValue);
      const safeLimit = Number.isFinite(num) && num > 0 ? num : 10;
      sb.append('| limit ');
      sb.append(String(safeLimit));
      sb.append(' ');
    }
    logsql.value = sb.toString();
  };
  const getFieldsByStreamFields = (streamField?: string, operator?: string, value?: string | null) => {
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

  const onDynamicFieldSelectChange = async (value?: string | null) => {
    setFieldSelectorDynamicValue(value ?? null);
    // todo: 拉 n 个值，猜测数据类型
    const uid = await resolveDatasourceUid();
    if (!uid) {
      // eslint-disable-next-line no-console
      console.error('field_values: datasource uid not found');
      return;
    }
    try {
      const resp = await getBackendSrv().post(
        `/api/datasources/uid/${uid}/resources/select/logsql/field_values`,
        {
          query: '*',
          start: '1d',
          limit: '50',
          field: value,
        }
      );
      const isAllNumber =
        Array.isArray(resp?.values) &&
        resp.values.every((item: any) => {
          const v = item?.value;
          const n = Number(v);
          return Number.isFinite(n);
        });
      console.info('field_values isAllNumber', isAllNumber);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('field_values error', err);
    }
  };

  const onDynamicFieldOperatorChange = (value?: string | null) => {
    setFieldOperatorDynamicValue(value ?? null);
  };

  const onAddFieldFilterClick = () => {
    const fieldVal = fieldSelectorDynamicValue ?? '';
    const operatorVal = fieldOperatorDynamicValue ?? '';
    const valueVal = fieldValueDynamic ?? '';
    if (!fieldVal || !operatorVal || !valueVal) {
      return;
    }
    const operatorText =
      (fieldOperatorDynamicOptions.find((o) => o.value === operatorVal)?.label ??
        defaultFieldOperatorOptions.find((o) => o.value === operatorVal)?.label ??
        operatorVal);
    fieldFiltersRef.current[fieldVal] = { operator: operatorVal, value: valueVal };

    const addedTd = document.getElementById('addedFieldFilters') as HTMLTableCellElement | null;
    if (addedTd) {
      const div = document.createElement('div');
      const textSpan = document.createElement('span');
      textSpan.textContent = `${fieldVal} ${operatorText} ${valueVal} `;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '❌';
      removeBtn.style.border = 'none';
      removeBtn.addEventListener('click', () => onRemoveFieldFilterClick(div, fieldVal));
      div.appendChild(textSpan);
      div.appendChild(removeBtn);
      addedTd.appendChild(div);
    }
    // if (textarea) {
    //   textarea.value = `field: ${fieldVal}\noperator: ${operatorVal}\nvalue: ${valueVal}`;
    // }


    generateLogsQL();
  };
  const fullTextSearchOptions: Option[] = [
    { label: '(word/phrase)', value: 'xxx' },
    { label: '= (equal)', value: '=xxx' },
    { label: '~ (regexp match)', value: '~xxx' },
    { label: '!~ (not match)', value: '!~xxx' },
    { label: 'xx* (prefix)', value: 'xxx*' },
    { label: '*xx* (substring)', value: '*xxx*' },
  ];

  const onRemoveFieldFilterClick = (wrapper: HTMLElement, fieldKey: string) => {
    wrapper.remove();
    delete fieldFiltersRef.current[fieldKey];
    generateLogsQL();
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
    const logsqlEl = document.getElementById('logsql') as HTMLTextAreaElement | null;
    const startTs = timeRangeRef.current?.from?.valueOf();
    const endTs = timeRangeRef.current?.to?.valueOf();
    const query = logsqlEl?.value ?? '';

    if (!startTs || !endTs || !query || !datasourceUid) {
      setTestResult('Missing time range, query, or datasource UID');
      setTestError('');
      return;
    }
    setTestResult('Testing LogsQL...');
    setTestError('');

    const body = {
      queries: [
        {
          //refId: 'log-volume-A',
          datasource: { type: 'victoriametrics-logs-datasource', uid: datasourceUid },
          //editorMode: 'code',
          expr: query,
          queryType: 'hits',
          maxLines: 100,
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
        const status = resp?.results?.A?.status ?? 200;
        switch (status) {
          case 200:
            {
              const frames = resp?.results?.A?.frames;
              let formatted = '';
              if (Array.isArray(frames) && frames.length > 0) {
                const values = frames[0]?.data?.values;
                if (
                  Array.isArray(values) &&
                  Array.isArray(values[0]) &&
                  Array.isArray(values[1]) &&
                  values[0].length > 0 &&
                  values[1].length > 0
                ) {
                  const ts = Number(values[0][0]);
                  const val = values[1][0];
                  const pad = (n: number) => String(n).padStart(2, '0');
                  if (Number.isFinite(ts)) {
                    const d = new Date(ts);
                    formatted = ` * ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
                      d.getHours()
                    )}:${pad(d.getMinutes())}:${pad(d.getSeconds())} hits=${String(val)}`;
                  }
                }
              }
              setTestResult('LogsQL test success:' + formatted);
              setTestError('');
            }
            break;
          default:
            setTestResult(String(status));
            setTestError(resp?.results?.A?.error ?? '');
            break;  
        }
      })
      .catch((err:any)=>{
        setTestResult(err?.statusText ?? '');
        setTestError(err?.data?.results?.A?.error ?? '');
      })

      // .catch((err) => {
      //   setTestResult('LogsQL test error');
      //   try {
      //     const parsed = (err as any)?.response?.data?.results?.A?.error ?? '';
      //     setTestError(String(parsed));
      //   } catch {
      //     setTestError(String(err));
      //   }
      // });
  };

  // 当输入正则表达式变化时
  const onStreamFieldValueBlur = async (streamField: string, operator: string, val: string) => {
    const m = streamFiltersRef.current;
    if (streamField) {
      m[streamField] = { operator: operator ?? '', value: val ?? '' };
      generateLogsQL();
      await loadFieldNamesByStreamFields();
    }
  };

  const loadFieldNamesByStreamFields = async () => {
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
            expressions.push(`\"${key}\"${mapped.replace('xxx', JSON.stringify(val ?? ''))}`);
          } else {
            expressions.push(`\"${key}\"${mapped}${val}`);
          }
        });
      }
      const queryExpr = expressions.join(' ');   // 表达式之间以空格分割
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
      if (source && source instanceof HTMLElement) {
        const options =
          Array.isArray(resp?.values) && resp.values.length
            ? resp.values.map((item: any) => ({
                label: '(' + String(item.hits) + ')' + item?.value,
                value: item?.value,
              }))
            : [];
        renderValueSelectForWrapper(source, options, operator, streamField);
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
        generateLogsQL();
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
    const nameWidth : number = 250;
    nameTd.style.width = `${nameWidth}px`;
    nameTd.innerHTML = `
      <span style="display:inline-block;max-width:${nameWidth}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:${nameWidth}px;text-align:right;" title="hits:${hits}">
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

  const onClickQueryButton = () => {
    const logsqlEl = document.getElementById('logsql') as HTMLTextAreaElement | null;
    const logsql = logsqlEl?.value ?? '';
    console.info('onClickQueryButton', logsql);
    if (!logsqlEl) {
      setTestError('logsql element not found');
      return;
    }
    if (!logsql) {
      setTestError('logsql is empty');
      return;
    }
    locationService.partial({ 'var-logsql': logsql }, true);
    setTestResult('Query applied and dashboard refresh triggered');
    // const url = new URL(window.location.href);
    // url.searchParams.set('var-logsql', logsql);
    // window.history.replaceState({}, '', url.toString());

    // try {
    //   const appEvents = getAppEvents();
    //   // trigger dashboard variable refresh + panel reload
    //   appEvents.publish({ type: 'dashboards-refresh' } as any);
    //   appEvents.publish({ type: 'refresh' } as any);
    //   setTestResult('Query applied and dashboard refresh triggered');
    // } catch (err) {
    //   setTestError('Failed to trigger dashboard refresh');
    //   console.error('dashboard refresh error', err);
    // }
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
                      <table style={{ width: '800' }}>
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
                            <td colSpan={2} id="addedFieldFilters">

                            </td>
                          </tr>
                          <tr>
                            <td valign="top">
                              <Select
                                width={25}
                                options={fieldSelectorDynamicOptions}
                                allowCustomValue={true}
                                placeholder="Select field"
                                id="selForFieldNames"
                                value={fieldSelectorDynamicOptions.find((o) => o.value === fieldSelectorDynamicValue)}
                                onChange={(v) => onDynamicFieldSelectChange(v.value)}
                              />
                            </td>
                            <td valign="top">
                              <Select
                                width={25}
                                options={
                                  fieldOperatorDynamicOptions.length
                                    ? fieldOperatorDynamicOptions
                                    : defaultFieldOperatorOptions
                                }
                                allowCustomValue={false}
                                placeholder="Choose operator"
                                value={fieldOperatorDynamicOptions.find((o) => o.value === fieldOperatorDynamicValue)}
                                onChange={(v) => onDynamicFieldOperatorChange(v.value)}
                              />
                            </td>
                            <td valign="top">
                              <TextArea
                                placeholder="input field value"
                                value={fieldValueDynamic}
                                onChange={(e) => setFieldValueDynamic(e.currentTarget.value)}
                              />
                            </td>
                            <td valign="top">
                              <span style={{ padding: '3px' }}>
                                <button onClick={onAddFieldFilterClick}>Add</button>
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 12px 4px 0', whiteSpace: 'nowrap' }}>message:</td>
                    <td style={{ padding: '4px 0' }} valign="top">
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', maxWidth: '500px' }}>
                        <Combobox
                          width={25}
                          options={[
                            { label: ':~ (regexp match)', value: ':~' },
                            { label: ':!~ (not match)', value: ':!~' },
                          ]}
                          onChange={(v) => onFieldOperatorChange(v.value)}
                          placeholder="choose operator"
                        />
                        <TextArea
                          aria-label="Message value"
                          value={messageValue}
                          onChange={(e) => setMessageValue(e.currentTarget.value)}
                          onBlur={(e) => onFieldValueBlur(e.currentTarget.value)}
                          rows={3}
                          style={{ flex: 1 }}
                          placeholder="enter search content for _msg field"
                        />
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 12px 4px 0', whiteSpace: 'nowrap' }}>Full text search:</td>
                    <td style={{ padding: '4px 0' }}  valign="top">
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', maxWidth: '500px' }}>
                      <Select
                        width={25}
                        options={fullTextSearchOptions}
                        allowCustomValue={false}
                        placeholder="choose operator"
                        value={
                          fullTextSearchOperator
                            ? fullTextSearchOptions.find((o) => o.value === fullTextSearchOperator) ?? null
                            : null
                        }
                        onChange={(v) => setFullTextSearchOperator(v.value ?? null)}
                      />
                      <TextArea
                        aria-label="Full text search"
                        placeholder="enter full text search content"
                        value={fullTextSearch}
                        onChange={(e) => setFullTextSearch(e.currentTarget.value)}
                        onBlur={(e) => onFullTextSearchBlur(e.currentTarget.value)}
                        rows={3}
                          style={{ flex: 1 }}
                      />
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 12px 4px 0', whiteSpace: 'nowrap' }}>query options</td>
                    <td style={{ padding: '4px 0' }}>


                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 12px 4px 0', whiteSpace: 'nowrap' }}>output options</td>
                    <td style={{ padding: '4px 0' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="checkbox"
                          checked={limitEnabled}
                          onChange={(e) => {
                            setLimitEnabled(e.currentTarget.checked);
                            //generateLogsQL();
                          }}
                        />
                        <span>limit:</span>
                        <input
                          type="number"
                          value={limitValue}
                          onChange={(e) => setLimitValue(e.currentTarget.value)}
                          //onBlur={() => generateLogsQL()}
                          style={{ width: '80px' }}
                        />
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'center', paddingTop: '12px' }}>
                      <button
                        type="button"
                        onClick={onClickQueryButton}
                        style={{ padding: '10px 24px', fontSize: '16px', borderRadius: '6px' }}
                      >
                        Query
                      </button>
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
              <div id="testResult">{testResult}</div>
              {testError ? <div style={{ color: 'red' }}>{testError}</div> : null}
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
