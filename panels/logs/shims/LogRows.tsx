import React from 'react';

import { LogRowList } from './LogRowList';
import type { SimpleLogRow } from './logsModel';

export const LogRows: React.FC<{
  logRows?: SimpleLogRow[];
  showTime?: boolean;
  wrapLogMessage?: boolean;
  expandAll?: boolean;
  highlightTerm?: string;
  wrapTags?: boolean;
  children?: React.ReactNode;
}> = ({ logRows, showTime, wrapLogMessage, expandAll, highlightTerm, wrapTags, children }) => {
  return (
    <div>
      <LogRowList
        rows={logRows}
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
