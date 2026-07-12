import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

export interface UploadedReport {
  id: string;
  title: string;
  fileName: string;
  type: 'blood_test' | 'xray' | 'mri' | 'ct_scan' | 'ultrasound' | 'lab_report' | 'prescription' | 'discharge_summary' | 'other';
  uploadDate: string;
  fileSize: number;
  description?: string;
  status: 'pending' | 'reviewed' | 'archived';
  mimeType: string;
}

export interface ReportUploadData {
  title: string;
  type: string;
  description?: string;
  reportDate?: string;
}

const REPORTS_KEY = ['reports', 'mine'] as const;

/**
 * The patient's uploaded reports plus the write operations on them.
 * All mutations invalidate the shared query, so every consumer (tab panel,
 * overview stat card) stays consistent without prop-drilling state.
 */
export function useReports(enabled = true) {
  const client = useQueryClient();

  const query = useQuery({
    queryKey: REPORTS_KEY,
    queryFn: async () => {
      const response = await apiClient.get('/reports/my-reports');
      return (response.data.data ?? []) as UploadedReport[];
    },
    enabled,
  });

  const uploadReport = async (file: File, data: ReportUploadData): Promise<void> => {
    const formData = new FormData();
    formData.append('report', file);
    formData.append('title', data.title);
    formData.append('type', data.type);
    if (data.description) formData.append('description', data.description);
    if (data.reportDate) formData.append('reportDate', data.reportDate);

    const response = await apiClient.post('/reports/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    if (!response.data.success) {
      throw new Error(response.data.message || 'Upload failed');
    }
    await client.invalidateQueries({ queryKey: REPORTS_KEY });
  };

  const removeReport = async (reportId: string): Promise<void> => {
    const response = await apiClient.delete(`/reports/${reportId}`);
    if (response.data.success) {
      await client.invalidateQueries({ queryKey: REPORTS_KEY });
    }
  };

  // window.open cannot send auth headers, so download through the API client.
  const downloadReport = async (reportId: string, fileName: string): Promise<void> => {
    const response = await apiClient.get(`/reports/${reportId}/download`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data as unknown as BlobPart]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName || 'report');
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  return {
    reports: query.data ?? [],
    isLoading: query.isLoading,
    uploadReport,
    removeReport,
    downloadReport,
  };
}
