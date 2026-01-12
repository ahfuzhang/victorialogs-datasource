import React from 'react';

import { LogRowList } from './LogRowList';
import type { SimpleLogRow } from './logsModel';

export const LogList: React.FC<{
  logs?: SimpleLogRow[];
  showTime?: boolean;
  wrapLogMessage?: boolean;
  expandAll?: boolean;
  highlightTerm?: string;
  wrapTags?: boolean;
  children?: React.ReactNode;
}> = ({ children, logs, showTime, wrapLogMessage, expandAll, highlightTerm, wrapTags }) => {
  if (!logs || logs.length === 0) {
    return null;
  }
  return (
    <div>
      <LogRowList
        rows={logs}
        showTime={showTime}
        wrapLogMessage={wrapLogMessage}
        expandAll={expandAll}
        highlightTerm={highlightTerm}
        wrapTags={wrapTags}
      />
      {children}
    </div>
  );
};
