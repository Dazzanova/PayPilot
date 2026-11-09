import React from 'react';
import { Badge } from '../ui/Badge';
import type { PayrollImportBatch } from '../../types';

export const PayrollImportStatusBadge: React.FC<{ batch: PayrollImportBatch }> = ({
  batch,
}) => {
  if (batch.status === 'PROCESSING') {
    return (
      <Badge variant="info" dot size="sm">
        Processing
      </Badge>
    );
  }

  if (batch.status === 'FAILED') {
    return (
      <Badge variant="danger" dot size="sm">
        Failed
      </Badge>
    );
  }

  if (batch.errorCount > 0) {
    return (
      <Badge variant="warning" dot size="sm">
        Completed with errors
      </Badge>
    );
  }

  return (
    <Badge variant="success" dot size="sm">
      Valid
    </Badge>
  );
};
