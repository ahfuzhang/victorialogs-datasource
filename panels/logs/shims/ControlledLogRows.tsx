import React from 'react';

import { LogRowList } from './LogRowList';
import type { SimpleLogRow } from './logsModel';

type Props = {
  logRows?: SimpleLogRow[];
  showTime?: boolean;
  wrapLogMessage?: boolean;
  expandAll?: boolean;
  highlightTerm?: string;
  wrapTags?: boolean;
  children?: React.ReactNode;
};

export const ControlledLogRows = React.forwardRef<HTMLDivElement, Props>(
  ({ logRows, showTime, wrapLogMessage, expandAll, highlightTerm, wrapTags, children }, ref) => {
    return (
      <div ref={ref as React.RefObject<HTMLDivElement>}>
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
  }
);

ControlledLogRows.displayName = 'ControlledLogRows';
