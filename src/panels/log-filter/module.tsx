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
type PanelContext = { 
  streamFilters: React.MutableRefObject<Record<string, Filter>>; 
  fieldFilters: React.MutableRefObject<Record<string, Filter>>; 
  messageFilter: React.MutableRefObject<Record<string, Filter>>; 
  timeRangeRef?: React.MutableRefObject<TimeRange | undefined>;
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

const ValueSelect: React.FC<{
  options: Option[];
  operator?: string;
  streamField?: string;
  selectId: string;
  placeholder?: string;
  onInput?: (val: string | undefined | null) => void | Promise<void>;
  panelCtx: PanelContext;
}> = ({ options, operator, streamField, selectId, placeholder, onInput, panelCtx }) => {
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
      onChange={v => {
        getFieldsByStreamFields(panelCtx, streamField, operator, v.value);
      }}
      onInputChange={(inputValue, actionMeta: any) => {
        if (actionMeta?.action === 'input-change') {
          onInput?.(inputValue);
        }
      }}
    />
  );
};

const getFieldsByStreamFields = (
  panelCtx: PanelContext,
  streamField?: string,
  operator?: string,
  value?: string | null
) => {
  const textarea = document.getElementById('response_data') as HTMLTextAreaElement | null;
  if (textarea) {
    const text = `${streamField ?? ''} ${operator ?? ''} ${value ?? ''}`.trim();
    textarea.value = text;
  }
  const m = panelCtx?.streamFilters?.current;
  if (m && streamField) {
    // 记录下修改后的 stream filter
    m[streamField] = { operator: operator ?? '', value: value ?? '' };
    //
    generateLogsQL(panelCtx);
  }
};

const generateLogsQL = (panelCtx: PanelContext) => {
  const logsql = document.getElementById('logsql') as HTMLTextAreaElement | null;
  if (!logsql){
    return;
  }
  let sb = createStringBuilder()
  
  const startStr = panelCtx.timeRangeRef?.current?.from?.toISOString();
  const endStr = panelCtx.timeRangeRef?.current?.to?.toISOString();
  if (startStr && endStr) {
    sb.append('_time:[')
    sb.append(startStr);
    sb.append(', ');
    sb.append(endStr);
    sb.append('] ')
  }
  let m = panelCtx.streamFilters.current
  if (Object.keys(m).length>0){
    sb.append('{')
    let isFirst = true
    for (let k in m) {
      if (isFirst){
        isFirst = false
      } else {
        sb.append(',')
      }
      sb.append(k)
      sb.append(m[k].operator)
      sb.append(JSON.stringify(m[k].value ?? ''))
    }
    sb.append('} ')
  }
  if ('_msg' in panelCtx.messageFilter.current){
    let v = panelCtx.messageFilter.current['_msg']
    if (v.operator.length>0 && v.value.length>0){
      sb.append('_msg')
      sb.append(v.operator)
      sb.append(JSON.stringify(v.value ?? ''))
      sb.append(' ')
    }
  }
  
  logsql.value = sb.toString();
}

const LogFilterPanel: React.FC<PanelProps<LogFilterOptions>> = ({ height, timeRange, data }) => {
  const [demoOption, setDemoOption] = useState<string | null>(null);
  const [fieldSelectorValue, setFieldSelectorValue] = useState<string | null>(null);
  const [datasourceUid, setDatasourceUid] = useState<string | null>(null);
  const timeRangeRef = useRef<TimeRange | undefined>(timeRange);
  const valueSelectRoots = useMemo(() => new WeakMap<HTMLElement, Root>(), []);
  const streamFieldMapRef = useRef<Record<string, null>>({});
  const fieldMapRef = useRef<Record<string, any>>({});
  const streamFiltersRef = useRef<Record<string, Filter>>({});
  const fieldFiltersRef = useRef<Record<string, Filter>>({});
  const msgFiltersRef = useRef<Record<string, Filter>>({});
  const onTimeRangeChange = (tr?: TimeRange) => {
    // const startStr = tr?.from?.toISOString();
    // const endStr = tr?.to?.toISOString();
    // // placeholder: react to time range change without resetting form state
    // console.info('time range changed', startStr, endStr);
    generateLogsQL({
      streamFilters: streamFiltersRef,
      fieldFilters: fieldFiltersRef,
      messageFilter: msgFiltersRef,
      timeRangeRef,
    });
  };

  // 选择的字段发生变化的时候，调整出现的 operator
  const onFieldSelectorChange = (tr: HTMLTableRowElement, value?: string | null) => {
    setFieldSelectorValue(value ?? null);
    // 先拉取 n 条数据猜测一下数据类型
    // http://127.0.0.1:9429/select/logsql/field_values?query=*&field=Properties.Code&start=1d&limit=100
  };

  const onFieldOperatorChange = (value?: string | null) => {
    const op = value ?? '';
    const m = msgFiltersRef.current;
    if ('_msg' in m) {
      m['_msg'].operator = op;
    } else {
      m['_msg'] = { operator: op, value: '' };
    }
    generateLogsQL({
      streamFilters: streamFiltersRef,
      fieldFilters: fieldFiltersRef,
      messageFilter: msgFiltersRef,
      timeRangeRef,
    });
  };

  const onFieldValueBlur = (val: string) => {
    const m = msgFiltersRef.current;
    if ('_msg' in m) {
      m['_msg'].value = val ?? '';
    } else {
      m['_msg'] = { operator: ':~', value: val ?? '' };
    }
    generateLogsQL({
      streamFilters: streamFiltersRef,
      fieldFilters: fieldFiltersRef,
      messageFilter: msgFiltersRef,
      timeRangeRef,
    });
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
      from: String(startTs),  // 单位确实是毫秒
      to: String(endTs),
    };

    getBackendSrv()
      .post(`/api/ds/query?ds_type=victoriametrics-logs-datasource&requestId=logsql_test`, body)
      .then(resp => {
        if (respTextarea) {
          respTextarea.value = JSON.stringify(resp, null, 2);
        }
      })
      .catch(err => {
        if (respTextarea) {
          respTextarea.value = String(err);
        }
      });
  };

  // 当输入正则表达式变化时
  const onStreamFieldValueBlur = (streamField:string, operator:string, val: string) => {
    const m = streamFiltersRef.current;
    if (streamField) {
      m[streamField] = { operator: operator ?? '', value: val ?? '' };
      generateLogsQL({ 
        streamFilters: streamFiltersRef, 
        fieldFilters: fieldFiltersRef,
        messageFilter: msgFiltersRef,
        timeRangeRef,
      });
    }
    // const textarea = document.getElementById('response_data') as HTMLTextAreaElement | null;
    // if (textarea) {
    //   textarea.value = val;
    // }
  };

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
        onInput={inputValue => streamFieldOnValueInputChange(wrapper, inputValue, operator, streamField)}
        panelCtx={{ 
          streamFilters: streamFiltersRef, 
          fieldFilters: fieldMapRef,
          messageFilter: msgFiltersRef,
          timeRangeRef,
         }}
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
              label: ('(' + String(item.hits) + ')' + item?.value), 
              value: item?.value 
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
        return;
      case '=':
      case '!=':
        if (!streamField) {
          return;
        }
        await showStreamFieldValueSelector(targetCell, operator, streamField);
        return;
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
              onBlur={e => {
                onStreamFieldValueBlur(streamField, operator, e.currentTarget.value);
              }}
            />
          );
        }
        return;
      default:
        alert("not support operator:" + operator);
        return;
    }
  };

  const showStreamFieldValueSelector = async (
    targetCell: HTMLElement,
    operator?: string,
    streamField?: string
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
      // eslint-disable-next-line no-console
      console.error('stream_field_values: datasource uid not found');
      return;
    }

    try {
      const resp = await getBackendSrv().post(`/api/datasources/uid/${uid}/resources/select/logsql/stream_field_values`, {
        field: streamField,
        query: '*',
        start: '',
        end: '',
        limit: '50',
      });
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
    nameTd.style.width="220px"
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
    const fetchFields = async (streamFields: any) =>{
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
    if (!textarea){
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
    const sysFields: Record<string, null> = {
      _msg: null,
      _stream: null,
      _stream_id: null,
      _time: null,
    };
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
    textarea.value += '\n\n' + JSON.stringify(fieldMap);
    // if (textarea) {
    //   textarea.value = JSON.stringify(fieldMap);
    // }
    showFieldSelector()
  };

  // 展示 field 的选择框
  const showFieldSelector = () => {
    const tbody = document.getElementById('field_filter_tbody') as HTMLTableSectionElement | null;
    if (!tbody) {
      return;
    }

    while (tbody.firstChild) {
      tbody.removeChild(tbody.firstChild);
    }

    const tr = document.createElement('tr');
    const td1 = document.createElement('td');

    const radioGroup = document.createElement('div');
    const radioAllId = 'field-selector-scope-all';
    const radioFilterId = 'field-selector-scope-filter';
    const radioAll = document.createElement('input');
    radioAll.type = 'radio';
    radioAll.name = 'field-selector-scope';
    radioAll.id = radioAllId;
    radioAll.value = 'all';
    const radioAllLabel = document.createElement('label');
    radioAllLabel.htmlFor = radioAllId;
    radioAllLabel.textContent = 'all';
    radioGroup.appendChild(radioAll);
    radioGroup.appendChild(radioAllLabel);

    const radioFilter = document.createElement('input');
    radioFilter.type = 'radio';
    radioFilter.name = 'field-selector-scope';
    radioFilter.id = radioFilterId;
    radioFilter.value = 'filter';
    radioFilter.checked = true;
    const radioFilterLabel = document.createElement('label');
    radioFilterLabel.htmlFor = radioFilterId;
    radioFilterLabel.textContent = 'filter by stream fields';
    radioGroup.appendChild(radioFilter);
    radioGroup.appendChild(radioFilterLabel);

    td1.appendChild(radioGroup);
    td1.appendChild(document.createElement('br'));
    //td1.textContent = 'field selector placeholder';
    const selectMount = document.createElement('div');
    td1.appendChild(selectMount);
    const keys = Object.keys(fieldMapRef.current ?? {}).sort();
    const options: Option[] = keys.map(k => ({ label: k, value: k }));
    const root = createRoot(selectMount);
    root.render(
      <Select
        width={40}
        placeholder="Select field"
        options={options}
        value={options.find(o => o.value === fieldSelectorValue)}
        onChange={v => onFieldSelectorChange(tr, v.value ?? null)}
        //panelCtx={{ fieldMapRef }}
      />
    );
    tr.appendChild(td1);
    
    const td2 = document.createElement('td');
    // const opSelect = document.createElement('select');
    // opSelect.style.height = '32px';
    // opSelect.style.padding = '4px 8px';
    // opSelect.style.marginRight = '8px';
    // [
    //   { value: ':=', label: ':= (equal)' },
    //   { value: '!=', label: '!= (not equal)' },
    //   { value: ':~', label: ':~  (regexp match)' },
    // ].forEach(opt => {
    //   const option = document.createElement('option');
    //   option.value = opt.value;
    //   option.text = opt.label;
    //   opSelect.appendChild(option);
    // });
    // td2.appendChild(opSelect);
    tr.appendChild(td2);
    const td3 = document.createElement('td');
    td3.textContent = 'field selector placeholder';
    tr.appendChild(td3);
    tbody.appendChild(tr);
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
                <tbody id="field_filter_tbody"></tbody>
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
                  onChange={v => onFieldOperatorChange(v.value)}
                  placeholder="op"
                />
                <input
                  type="text"
                  width={40}
                  style={{ flex: 1, height: '32px', padding: '4px 8px' }}
                  placeholder="enter value"
                  onBlur={e => onFieldValueBlur(e.currentTarget.value)}
                />
              </div>
            </td>
          </tr>
           <tr>
            <td style={{ padding: '4px 12px 4px 0', whiteSpace: 'nowrap' }}>Full text searc:</td>
            <td style={{ padding: '4px 0' }}>
              <textarea>

              </textarea>

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
                  onChange={v => setDemoOption(v.value ?? null)}
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
