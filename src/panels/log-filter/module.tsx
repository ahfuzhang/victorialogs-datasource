import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PanelEvents, PanelPlugin, type PanelProps, type TimeRange } from '@grafana/data';
import { Combobox, Select, Switch, TextArea } from '@grafana/ui';
import { getBackendSrv } from '@grafana/runtime';
import { locationService } from '@grafana/runtime';

interface LogFilterOptions {
  showLogsqlTextarea?: boolean;
  streamFieldList?: string;
  logsqlVariable?: string;
  jsonConfig?: string;
}

type Option = { label: string; value: string };
type Filter = { operator: string; value: string };
type ExtraStreamFilterValue = { regexp?: string; group_name?: string };
type ExtraStreamFilterRule = {
  name: string;
  if_exists?: { field: string; operator: string };
  operator: string;
  value?: ExtraStreamFilterValue;
};

type FixedFieldFilterRule = {
  field: string;
  text: string;
  operator: string;
};

type JsonConfigShape = {
  extra_stream_filter?: ExtraStreamFilterRule[];
  fixed_field_filter?: FixedFieldFilterRule[];
};

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

const defaultRecordCount = 50;

const LogFilterPanel: React.FC<PanelProps<LogFilterOptions>> = ({ height, timeRange, data, options, eventBus }) => {
  const showLogsqlTextarea = options?.showLogsqlTextarea ?? true;
  const logsqlVariable = options?.logsqlVariable ?? '\$logsql';
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
  const [cascadeFiltering, setCascadeFiltering] = useState<boolean>(true);
  const [jsonConfig, setJsonConfig] = useState<string>(options?.jsonConfig ?? '');
  const [outputAllFields, setOutputAllFields] = useState<boolean>(true);
  const [testResult, setTestResult] = useState<string>('');
  const [testError, setTestError] = useState<string>('');
  const [datasourceUid, setDatasourceUid] = useState<string | null>(null);
  const [filterByStreamFields, setFilterByStreamFields] = useState<boolean>(true);
  const timeRangeRef = useRef<TimeRange | undefined>(timeRange);
  const datasourceVarValueRef = useRef<string | null>(null);
  const valueSelectRoots = useMemo(() => new WeakMap<HTMLElement, Root>(), []);
  const streamFieldMapRef = useRef<Record<string, null>>({});
  const fieldMapRef = useRef<Record<string, any>>({});  // 第一次查询得到的 field names 列表
  const fieldsAfterStreamFilterRef = useRef<Record<string, null>>({});  // stream fields 过滤后的字段
  const streamFiltersRef = useRef<Record<string, Filter>>({}); // 当前已经选中的
  const fieldFiltersRef = useRef<Record<string, Filter>>({});
  const msgFiltersRef = useRef<Record<string, Filter>>({});
  const fulltextFiltersRef = useRef<Record<string, Filter>>({});
  const jsonConfigRef = useRef<JsonConfigShape | null>(null);  // 存在面板配置中的 json config
  // 根据顺序进行加载的 stream field 数据
  const streamFieldIndexMapRef = useRef<Record<number, string>>({});
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
  useEffect(() => {
    setJsonConfig(options?.jsonConfig ?? '');
  }, [options?.jsonConfig]);
  useEffect(() => {
    try {
      jsonConfigRef.current = jsonConfig ? (JSON.parse(jsonConfig) as JsonConfigShape) : null;
    } catch (err) {
      jsonConfigRef.current = null;
      console.error('jsonConfig parse error', err);
    }
  }, [jsonConfig]);
  // 根据配置，创建固定的某个字段的过滤器 UI
  const createFixedFieldFilterFromConfig = () => {
    const addedTd = document.getElementById('addedFixedFieldFilters') as HTMLTableCellElement | null;
    if (!addedTd) {
      return;
    }

    const fixed_field_filter = jsonConfigRef.current?.fixed_field_filter ?? [];
    fixed_field_filter.forEach((item) => {
      let operator: string = '';
      let operatorText: string = '';
      switch (item.operator) {
        case 'equal':
          operator = ':=';
          operatorText = ':= (equal)';
          break;
        default:
          alert("not supported operator:" + item.field + " " + item.operator);
          return;
      }
      const div = document.createElement('div');
      const span = document.createElement('span');
      let text = item?.text ?? "";
      if (text.length == 0) {
        text = (item?.field ?? '') + ': ';
      }
      span.textContent = text;
      span.style.display = 'inline-block';
      span.style.maxWidth = '250px';
      span.style.width = '250px';
      span.style.overflow = 'hidden';
      span.style.textOverflow = 'ellipsis';
      span.style.whiteSpace = 'nowrap';
      span.style.textAlign = 'right';
      span.style.paddingRight = '3px';
      div.appendChild(span);
      const input = document.createElement('input');
      input.type = 'text';
      input.style.width = '180px';
      input.addEventListener('blur', (e) => {
        const val = (e.currentTarget as HTMLInputElement).value;
        createOrUpdateFieldFilterData(item.field, operator, operatorText, val);
      });
      div.appendChild(input);
      addedTd.appendChild(div);
    });
  };
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
      // 检查是否有额外的 stream filter 配置
      if ((jsonConfigRef.current?.extra_stream_filter?.length ?? 0) > 0) {
        const extra_stream_filter = jsonConfigRef.current?.extra_stream_filter;
        extra_stream_filter?.forEach((item) => {
          const joinField = item?.if_exists?.field ?? "";
          if (!(joinField in fieldFiltersRef.current)) {
            return;
          }
          const fieldFilter = fieldFiltersRef.current[joinField];
          const fieldOperator = item?.if_exists?.operator ?? "";
          switch (fieldOperator) {
            case 'equal':
              if (fieldFilter.operator !== ':=xxx') {
                return;
              }
              break;
            default:
              alert("json config error, not supported operator:" + fieldOperator);
              return;
          }
          // 执行正则表达式
          const re = new RegExp(item?.value?.regexp ?? "");
          const m = re.exec(fieldFilter.value);
          if (!m) {
            alert("json config error, regexp error:" + (item?.value?.regexp ?? ""));
            return;
          }
          const result = m?.groups?.[item?.value?.group_name ?? ""] ?? "";
          if (result.length > 0) {
            // 输出额外的 stream filter
            if (Object.keys(streamFilters).length > 0) {
              sb.append(',');
            }
            sb.append(JSON.stringify(item?.name));
            const targetOperator = item?.operator ?? "";
            switch (targetOperator) {
              case 'equal':
                sb.append('=');
                break;
              default:
                alert("json config error, not supported target operator:" + targetOperator);
                return;
            }
            sb.append(JSON.stringify(result));
          }
        })
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
        sb.append(`${op.replace('xxx', JSON.stringify(val ?? ''))}`);
      } else {
        sb.append(op);
        sb.append(JSON.stringify(val ?? ''));
      }
      sb.append(' ');
    }
    //
    if ('_msg' in msgFiltersRef.current) {
      const v = msgFiltersRef.current['_msg'];
      if (v.operator.length > 0 && v.value.length > 0) {
        sb.append('_msg');
        switch (v.operator) {
          case ':~':
          case ':!~':
            sb.append(v.operator);
            sb.append(JSON.stringify(v.value ?? ''));
            break;
          case ':xxx*':
            sb.append(':')
            sb.append(JSON.stringify(v.value ?? ''));
            sb.append('*')
            break;
          case ':*xxx*':
            sb.append(':*')
            sb.append(JSON.stringify(v.value ?? ''));
            sb.append('*')
            break;
          default:
            alert('not support operator:' + v.operator);
            break;
        }
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
    if (
      Object.keys(streamFilters).length == 0 &&
      Object.keys(fieldFilters).length == 0 &&
      Object.keys(msgFiltersRef.current).length == 0 &&
      Object.keys(fulltextFiltersRef.current).length == 0
    ) {
      sb.append('* ');
    }
    // 输出字段
    const isAllField = getOutputFieldChooseMode();
    const txtFieldsList = document.getElementById('txtOutputFieldsList') as HTMLTextAreaElement | null;
    if (!isAllField && txtFieldsList && txtFieldsList.value.length > 0) {
      sb.append('| fields ')
      sb.append(tidyOutputFields(txtFieldsList.value).join(', '));
      sb.append(' ')
    }
    // limit 配置
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
     generateLogsQL();
  };

  const onDynamicFieldSelectChange = async (value?: string | null) => {
    setFieldSelectorDynamicValue(value ?? null);
    // todo: 拉 n 个值，猜测数据类型
    const uid = await resolveDatasourceUid();
    if (!uid) {
      console.error('field_values: datasource uid not found');
      return;
    }
    //const { start, end } = getTimeRangeMillis();
    try {
      const resp = await getBackendSrv().post(`/api/datasources/uid/${uid}/resources/select/logsql/field_values`, {
        query: '*',
        // start: String(start),
        // end: String(end),
        limit: `${defaultRecordCount}`,
        field: value,
      });
      const isAllNumber =
        Array.isArray(resp?.values) &&
        resp.values.every((item: any) => {
          const v = item?.value;
          const n = Number(v);
          return Number.isFinite(n);
        });
      console.info('field_values isAllNumber', isAllNumber);
    } catch (err) {
      console.error('field_values error', err);
    }
  };

  const onDynamicFieldOperatorChange = (value?: string | null) => {
    setFieldOperatorDynamicValue(value ?? null);
  };

  const createOrUpdateFieldFilterData = (fieldName: string,
    operator: string, operatorText: string, value: string) => {
    if (fieldName in fieldFiltersRef.current) {
      // 存在上次结果的基础上，应该删除 dom 中的 div 行
      const addedTd = document.getElementById('addedFieldFilters') as HTMLTableCellElement | null;
      if (addedTd) {
        Array.from(addedTd.children).forEach((child) => {
          const text = child.textContent ?? '';
          if (text.includes(fieldName)) {
            child.remove();
          }
        });
      }
    }
    if (value.length > 0) {
      fieldFiltersRef.current[fieldName] = { operator: operator, value: value };

      const addedTd = document.getElementById('addedFieldFilters') as HTMLTableCellElement | null;
      if (addedTd) {
        const div = document.createElement('div');
        const textSpan = document.createElement('span');
        textSpan.textContent = `${fieldName} ${operatorText} ${value} `;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '❌';
        removeBtn.style.border = 'none';
        removeBtn.addEventListener('click', () => onRemoveFieldFilterClick(div, fieldName));
        div.appendChild(textSpan);
        div.appendChild(removeBtn);
        addedTd.appendChild(div);
      }
    } else {
      delete fieldFiltersRef.current[fieldName];
    }
    generateLogsQL();
  }

  // 点击 add 按钮
  const onAddFieldFilterClick = () => {
    const fieldVal = fieldSelectorDynamicValue ?? '';
    const operatorVal = fieldOperatorDynamicValue ?? '';
    const valueVal = fieldValueDynamic ?? '';
    if (!fieldVal || !operatorVal || !valueVal) {
      return;
    }
    const operatorText =
      fieldOperatorDynamicOptions.find((o) => o.value === operatorVal)?.label ??
      defaultFieldOperatorOptions.find((o) => o.value === operatorVal)?.label ??
      operatorVal;
    createOrUpdateFieldFilterData(fieldVal, operatorVal, operatorText, valueVal);
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
          datasource: { type: 'victoriametrics-logs-datasource', uid: datasourceUid },
          expr: query,
          queryType: 'hits',
          maxLines: 100,
          step: '1d',
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
      .catch((err: any) => {
        setTestResult(err?.statusText ?? '');
        setTestError(err?.data?.results?.A?.error ?? '');
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
  };

  // stream filter 变更后，加载 field names
  const loadFieldNamesByStreamFields = async () => {
    const uid = await resolveDatasourceUid();
    if (!uid) {
      console.error('loadFFieldNamesByStreamFields: datasource uid not found');
      return;
    }
    const chkUseStreamFilter = document.getElementById('chkUseStreamFilter') as HTMLInputElement | null;
    const useStreamFilter = chkUseStreamFilter?.checked ?? false;
    if (!useStreamFilter) {
      // fieldMapRef 是第一次加载的 field 列表
      const opts: Option[] = Object.keys(fieldMapRef.current)
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
      const queryExpr = expressions.join(' '); // 表达式之间以空格分割
      //const { start, end } = getTimeRangeMillis();
      const resp = await getBackendSrv().post(`/api/datasources/uid/${uid}/resources/select/logsql/field_names`, {
        query: queryExpr,
        // start: String(start),
        // end: String(end),
        limit: `${defaultRecordCount}`,
      });

      const keys = Array.isArray(resp?.values)
        ? resp.values
          .map((item: any) => item?.value ?? '')
          .filter((k: string) => k !== '' && !(k in sysFields) && !(k in streamFieldMapRef.current))
          .sort()
        : [];
      const opts: Option[] = keys.map((k: string) => ({ label: k, value: k }));
      let temp: Record<string, any> = {};
      keys.forEach((item: string) => {
        temp[item] = null;
      });
      fieldsAfterStreamFilterRef.current = temp;
      setFieldSelectorDynamicOptions(opts);
      setFieldSelectorDynamicValue(null);
    } catch (err) {
      console.error('loadFFieldNamesByStreamFields error', err);
    }
  };

  // 查询当前的数据源 id
  const resolveDatasourceUid = async (): Promise<string | null> => {
    const targets = (data as any)?.request?.targets;
    let datasourceFromVar: string | null = null;
    try {
      datasourceFromVar = datasourceVarValueRef.current ?? locationService.getSearch().get('var-datasource');
    } catch (err) {
      console.error('resolveDatasourceUid: failed to read datasource variable', err);
    }
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
      if (datasourceFromVar) {
        uid = list?.find?.((ds: any) => ds.uid === datasourceFromVar || ds.name === datasourceFromVar)?.uid;
      }
      if (!uid) {
        uid = list?.find?.((ds: any) => ds.type === 'victoriametrics-logs-datasource')?.uid;
      }
      if (uid) {
        setDatasourceUid(uid);
        return uid;
      }
    } catch (err) {
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

  // 选择了 stream field 的 value 后: 同时还要触发 fields 的列表更新
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
      console.error('stream_field_names: datasource uid not found for input change');
      return;
    }

    //const { start, end } = getTimeRangeMillis();
    const path = `/api/datasources/uid/${uid}/resources/select/logsql/stream_field_values`;
    const payload = {
      field: streamField,
      query: `${streamField}:~\".*${val}.*\"`,
      limit: `${defaultRecordCount}`,
      // start: String(start),
      // end: String(end),
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

       console.log('stream_field_values input from', source, resp);
    } catch (err) {
      console.error('stream_field_names input change error', err);
    }
  };

  // 选择 stream field 的 operator 变更事件
  const on_operator_change = async (selectEl: HTMLSelectElement, valueCell?: HTMLElement | null) => {
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
        await showStreamFieldValueSelector(targetCell, operator, streamField, jsonData?.index);
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

  // 操作符变更的时候，动态拉取 stream field 的 value
  const showStreamFieldValueSelector = async (
    targetCell: HTMLElement,
    operator: string,
    streamField: string,
    index: number
  ) => {
    while (targetCell.firstChild) {
      targetCell.removeChild(targetCell.firstChild);
    }

    const wrapper = document.createElement('div');
    wrapper.dataset.streamValueSelect = 'true';
    targetCell.appendChild(wrapper);

    renderValueSelectForWrapper(wrapper, [], operator, streamField, 'loading...');

    const uid = await resolveDatasourceUid();
    if (!uid) {
      console.error('stream_field_values: datasource uid not found');
      return;
    }
    let queryStr: string = '*';
    if (cascadeFiltering) {
       if (index > 0 && index < Object.keys(streamFieldIndexMapRef.current).length) {
        const sb = createStringBuilder();
        const streamFilters = streamFiltersRef.current;
        for (let idx = 0; idx < index; idx++) {
          const streamFieldName = streamFieldIndexMapRef.current[idx];
          if (!(streamFieldName in streamFilters)) {
            // 上一级字段根本没选，跳过
            continue;
          }
          const filter = streamFilters[streamFieldName];
          sb.append(JSON.stringify(streamFieldName));
          switch (filter.operator) {
            case '=':
              sb.append(':=');
              break;
            case '!=':
              sb.append(':!');
              break;
            case '=~':
              sb.append(':~');
              break;
            case '!~':
              sb.append(':!~');
              break;
            default:
              alert('bad operator:' + filter.operator);
              break;
          }
          sb.append(JSON.stringify(filter.value));
          sb.append(' ');
        }
        queryStr = sb.toString();
      }
    }
    if (queryStr.trim() === '') {
      queryStr = '*';
    }
    //const { start, end } = getTimeRangeMillis();
    const resp = await getBackendSrv().post(`/api/datasources/uid/${uid}/resources/select/logsql/stream_field_values`, {
      field: streamField,
      query: queryStr,
      // start: String(start),
      // end: String(end),
      limit: `${defaultRecordCount}`,
    });
    const options =
      Array.isArray(resp?.values) && resp.values.length
        ? resp.values.map((item: any) => ({ label: item?.value ?? '', value: item?.value ?? '' }))
        : [];
    renderValueSelectForWrapper(wrapper, options, operator, streamField);
  };

  const each_stream_feild = (stream_field_name: string, hits: number, index: number) => {
    console.log('each_stream_feild', stream_field_name, hits);
    const tbody = document.getElementById('stream_filter_tbody') as HTMLTableSectionElement | null;
    if (!tbody) {
      return;
    }
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    const nameWidth: number = 250;
    nameTd.style.width = `${nameWidth}px`;
    nameTd.innerHTML = `
      <span style="display:inline-block;max-width:${nameWidth}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:${nameWidth}px;text-align:right;padding-right:3px;" title="hits:${hits}">
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
      optionEl.value = JSON.stringify({ stream_feild: stream_field_name, operator: opt.value, index: index });
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

  // 得到了 stream_field_names
  const on_stream_field_names_response = (resp: any) => {
    const tbody = document.getElementById('stream_filter_tbody');
    if (!tbody) {
      console.log('not found stream_filter_tbody');
      return;
    }
    tbody.innerHTML = '';
    if (!Array.isArray(resp?.values)) {
      alert('not an array');
      return;
    }
    const values = [...resp.values].sort((a: any, b: any) => {
        const ka = String(a?.value ?? '');
        const kb = String(b?.value ?? '');
        return ka.localeCompare(kb);
      });
    let m: Record<string, number> = {};
      for (let index in resp.values) {
        const item = resp.values[index];
        m[item.value] = item.hits;
      }  
    //
    const streamFieldList = options.streamFieldList ?? '';
    const shouldAutofill = streamFieldList.trim() === '';
    let configedStreamFields: string[] = [];
    if (!shouldAutofill) {
      const arr = streamFieldList.split(',');
      for (let index = 0; index < arr.length; index++) {
        const item = arr[index].trim();
        if (item !== '') {
          // 检查是否存在于当前查询得到的列表中
          if (!(item in m)) {
            configedStreamFields = [];
            setTestError('WARN: json config error: stream field "' + item + '" not found in datasource. Ignore json config stream field list.');
            break;
          }
          configedStreamFields.push(item);
        }
      }
    }
    // 当配置中有字段列表的时候，需要检查字段列表是否是当前查询得到的列表的子集。否则配置不生效
    if (configedStreamFields.length===0) {
      for (let index = 0; index < values.length; index++) {
        const item = values[index];
        streamFieldIndexMapRef.current[index] = item?.value;
        each_stream_feild(item?.value, item?.hits, index);
      }
    } else {
      // 根据配置中的顺序来填充 stream field
      for (let index = 0; index < configedStreamFields.length; index++) {
        const item = configedStreamFields[index];
        streamFieldIndexMapRef.current[index] = item;
        each_stream_feild(item, m[item], index);
      }
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
    const varName: Record<string, any> = {};
    // 根据配置中的变量名来输出
    let varKey = `var-${logsqlVariable}`;
    if (logsqlVariable.startsWith('$')) {
      varKey = `var-` + logsqlVariable.substring(1);
    }
    varName[varKey] = logsql;
    locationService.partial(varName, true);
    setTestResult('Query applied and dashboard refresh triggered');
  };

  const loadPanelData = async () => {
    const uid = await resolveDatasourceUid();

    if (!uid) {
      console.error('stream_field_names: datasource uid not found');
      return;
    }
    // 开始加载 stream field names
    const path = `/api/datasources/uid/${uid}/resources/select/logsql/stream_field_names`;
    const payload = {
      query: '*',
      // start: String(start),
      // end: String(end),
      limit: `${defaultRecordCount}`,
    };

    try {
      const streamFields = await getBackendSrv().post(path, payload);
      console.log('stream_field_names', streamFields);
      on_stream_field_names_response(streamFields);

      // 加载所有的 field names
      const fieldNames = await getBackendSrv().post(`/api/datasources/uid/${uid}/resources/select/logsql/field_names`, {
        query: '*',
        // start: String(start),
        // end: String(end),
        limit: `${defaultRecordCount}`,
      });
      handleFieldNamesResponse(streamFields, fieldNames);
    } catch (err) {
      console.error('stream_field_names error', err);
    }
  };

  useEffect(() => {
    loadPanelData();
    createFixedFieldFilterFromConfig();
  }, []);

  // keep latest timeRange in ref without resetting UI state
  useEffect(() => {
    timeRangeRef.current = timeRange;
    onTimeRangeChange(timeRange);
  }, [timeRange]);

  // 第一次加载 feild names
  const handleFieldNamesResponse = (streamFields: any, resp: any) => {
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
      });
    }
    fieldMapRef.current = fieldMap;
    showFieldSelector();
  };

  // 第一次加载时，展示 field 的选择框
  const showFieldSelector = () => {
    const keys = Object.keys(fieldMapRef.current ?? {}).sort();
    const opts: Option[] = keys.map((k) => ({ label: k, value: k }));
    setFieldSelectorDynamicOptions(opts);
    setFieldSelectorDynamicValue(null);
  };

  useEffect(() => {
    const datasourceUrlKey = 'var-datasource';
    const readDatasourceVariable = () => {
      try {
        return locationService.getSearch().get(datasourceUrlKey);
      } catch (err) {
        console.error('read datasource variable from url failed', err);
        return null;
      }
    };

    const resetFilters = () => {
      streamFiltersRef.current = {};
      fieldFiltersRef.current = {};
      msgFiltersRef.current = {};
      fulltextFiltersRef.current = {};
      fieldsAfterStreamFilterRef.current = {};
      
      const addedTd = document.getElementById('addedFieldFilters') as HTMLTableCellElement | null;
      if (addedTd) {
        addedTd.innerHTML = '';
      }
      const streamFilterTbody = document.getElementById('stream_filter_tbody') as HTMLTableSectionElement | null;
      if (streamFilterTbody) {
        streamFilterTbody.innerHTML = '';
      }
      setFieldSelectorDynamicValue(null);
      setFieldOperatorDynamicValue(null);
      setFieldValueDynamic('');
      setMessageValue('');
      setFullTextSearch('');
      setFullTextSearchOperator(null);
    };

    datasourceVarValueRef.current = readDatasourceVariable();
    const subscription = locationService.getLocationObservable().subscribe(() => {
      const currentValue = readDatasourceVariable();
      if (currentValue === datasourceVarValueRef.current) {
        return;
      }

      datasourceVarValueRef.current = currentValue;
      resetFilters();
      loadPanelData();
      generateLogsQL();
      eventBus.publish({ type: PanelEvents.refresh.name } as any);
    });

    return () => subscription.unsubscribe();
  }, []);

  const getOutputFieldChooseMode = (): boolean => {
    return outputAllFields;
  }

  // 点击显示全部字段的按钮
  const onRadioButtonAllFields = () => {
    const container = document.getElementById('chooseOutputFieldsContainer');
    if (!container) {
      return;
    }
    container.style.display = "none";
    generateLogsQL();
  };

  // 点击选择字段的按钮
  const onRadioButtonChooseFields = () => {
    const container = document.getElementById('chooseOutputFieldsContainer');
    if (!container) {
      return;
    }
    container.style.display = "block";
    let m = fieldsAfterStreamFilterRef.current;
    if (Object.keys(m).length == 0) {
      m = fieldMapRef.current;
    }
    const txtFieldsList = document.getElementById('txtOutputFieldsList') as HTMLTextAreaElement | null;
    if (txtFieldsList) {
      txtFieldsList.value = '_msg, ' + Object.keys(m).join(', ');
    }
    generateLogsQL();
  };

  const onClickMultiLineButton = () => {
    const txtFieldsList = document.getElementById('txtOutputFieldsList') as HTMLTextAreaElement | null;
    if (txtFieldsList) {
      txtFieldsList.value = tidyOutputFields(txtFieldsList?.value ?? '').join('\n');
    }
  }

  const onClickSingleLineButton = () => {
    const txtFieldsList = document.getElementById('txtOutputFieldsList') as HTMLTextAreaElement | null;
    if (txtFieldsList) {
      txtFieldsList.value = tidyOutputFields(txtFieldsList?.value ?? '').join(', ');
    }
  }

  const tidyOutputFields = (s: string): string[] => {
    let arr = s.split('\n');
    arr = arr.map((s) => s.trim());
    let arr2 = [];
    for (let i = 0; i < arr.length; i++) {
      let item = arr[i];
      if (item.includes(',')) {
        const temp = item.split(',').map((s) => s.trim());
        for (let j = 0; j < temp.length; j++) {
          if (temp[j] !== '') {
            arr2.push(temp[j]);
          }
        }
        continue;
      }
      if (item === '') {
        continue;
      }
      arr2.push(arr[i]);
    }
    return arr2.sort();
  }

  const outputAllFieldsOnChange = (next: boolean) => {
    if (next) {
      onRadioButtonAllFields();
    } else {
      onRadioButtonChooseFields();
    }
  };

  return (
    <div style={{ height, overflowY: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }} border={0}>
        <tbody>
          <tr>
            <td>
              <table style={{ borderCollapse: 'collapse', width: '100%' }} border={1}>
                <tbody>
                  <tr>
                    <td style={{ verticalAlign: 'top', paddingRight: '12px', whiteSpace: 'nowrap' }} width="100">
                      stream fields:
                      <br />
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={cascadeFiltering}
                          onChange={(e) => setCascadeFiltering(e.currentTarget.checked)}
                        />
                        Cascade Filtering
                      </label>
                    </td>
                    <td id="stream_filter_container" style={{ paddingBottom: '8px' }}>
                      <table style={{ width: '500' }}>
                        <tbody id="stream_filter_tbody"></tbody>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 12px 4px 0', whiteSpace: 'nowrap' }}>fields:
                      <br />
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
                    <td style={{ padding: '4px 0' }}>
                      <table style={{ width: '800' }}>
                        <tbody id="field_filter_tbody">
                          <tr>
                            <td colSpan={4} >
                              <div id="addedFixedFieldFilters"></div>
                              <div id="addedFieldFilters"></div>
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
                            { label: ':xxx* (prefix)', value: ':xxx*' },
                            { label: ':*xxx* (substring)', value: ':*xxx*' },
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
                    <td style={{ padding: '4px 0' }} valign="top">
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', maxWidth: '500px' }}>
                        <Select
                          width={25}
                          options={fullTextSearchOptions}
                          allowCustomValue={false}
                          placeholder="choose operator"
                          value={
                            fullTextSearchOperator
                              ? (fullTextSearchOptions.find((o) => o.value === fullTextSearchOperator) ?? null)
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
                    <td style={{ padding: '4px 0' }}></td>
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
                          }}
                        />
                        <span>limit:</span>
                        <input
                          type="number"
                          value={limitValue}
                          onChange={(e) => setLimitValue(e.currentTarget.value)}
                          style={{ width: '80px' }}
                        />
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td>Output fields:</td>
                    <td>
                      <div style={{ marginTop: '6px', display: 'inline-flex', gap: '12px', alignItems: 'center' }}>
                        <Switch
                          value={outputAllFields}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            const next = e.currentTarget.checked;
                            setOutputAllFields(next);
                            outputAllFieldsOnChange(next);
                          }}
                        />
                        <span>Output all fields</span>

                        <button
                          type="button"
                          onClick={() => {
                            onClickSingleLineButton();
                          }}
                        >
                          one line
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onClickMultiLineButton();
                          }}
                        >
                          multi line
                        </button>

                      </div>
                      <div id="chooseOutputFieldsContainer" style={{ display: 'none' }}>
                        <TextArea
                          aria-label="Output preview"
                          style={{ width: '100%', height: '150px' }}
                          id="txtOutputFieldsList"
                          onBlur={(e) => {
                            generateLogsQL();
                          }}
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
            <td width="400" valign="top" id="logsqlTextarea">
              <div style={{ display: showLogsqlTextarea ? 'block' : 'none' }}>
                <TextArea
                  aria-label="LogSQL output"
                  rows={10}
                  placeholder="LogSQL preview"
                  defaultValue=""
                  style={{ width: '100%' }}
                  id="logsql"
                />
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px' }}>
                  <button style={{ padding: '8px 8px' }} onClick={onLogsqlCopy}>
                    Copy LogSQL
                  </button>
                  <button style={{ padding: '8px 8px', marginLeft: '12px' }} onClick={onLogsqlTest}>
                    Test LogsQL
                  </button>
                  <button
                    type="button"
                    onClick={onClickQueryButton}
                    style={{ padding: '8px 8px', marginLeft: '12px' }}
                  >
                    Query
                  </button>
                </div>
                <div id="testResult">{testResult}</div>
                <div style={{ color: 'red' }}>{testError}</div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export const plugin = new PanelPlugin<LogFilterOptions>(LogFilterPanel).setPanelOptions((builder) =>
  builder
    .addBooleanSwitch({
      path: 'showLogsqlTextarea',
      name: 'Show logsql textarea',
      description: 'Show / hide the logsql textarea and actions',
      defaultValue: true,
    })
    .addTextInput({
      path: 'streamFieldList',
      name: 'Stream field list',
      description:
        'Enter the stream fields you want to display, separated by commas. (All stream fields will be displayed automatically by default.)',
      defaultValue: '',
    })
    .addTextInput({
      path: 'logsqlVariable',
      name: 'LogsQL Varaible',
      description:
        'After generating the logsql query statement, it can be output to a variable in a dashboard for other panels to reference.',
      defaultValue: '$logsql',
    })
    .addCustomEditor({
      id: 'jsonConfig',
      path: 'jsonConfig',
      name: 'JSON config',
      description:
        'Use JSON for more complex configurations. Please refer to the documentation for configuration syntax.',
      defaultValue: '',
      editor: ({ value, onChange }) => {
        const rows = Math.max(6, (value?.split('\n').length ?? 0) + 2);
        return (
          <TextArea
            aria-label="JSON config"
            rows={rows}
            placeholder="Use JSON for more complex configurations. Please refer to the documentation for configuration syntax."
            value={value ?? ''}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        );
      },
    })
);
