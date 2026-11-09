import { keycloak } from './keycloak';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: ApiErrorDetail[]
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
  };
}

class ApiClient {
  private async getAuthHeaders(): Promise<HeadersInit> {
    if (!keycloak.authenticated) {
      throw new ApiError('Not authenticated', 401, 'NOT_AUTHENTICATED');
    }

    try {
      await keycloak.updateToken(30);
    } catch {
      keycloak.clearToken();
      throw new ApiError('Session expired', 401, 'SESSION_EXPIRED');
    }

    if (!keycloak.token) {
      throw new ApiError('Not authenticated', 401, 'NOT_AUTHENTICATED');
    }

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${keycloak.token}`,
    };
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 401) {
      keycloak.clearToken();
      throw new ApiError('Session expired', 401, 'SESSION_EXPIRED');
    }

    const data: ApiResponse<T> = await response.json();

    if (!response.ok) {
      throw new ApiError(
        data.error?.message || 'Request failed',
        response.status,
        data.error?.code,
        data.error?.details
      );
    }

    if (!data.success || !data.data) {
      throw new ApiError('Invalid response from server', response.status);
    }

    return data.data;
  }

  async get<T>(endpoint: string): Promise<T> {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'GET',
      headers,
    });
    return this.handleResponse<T>(response);
  }

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(response);
  }

  async put<T>(endpoint: string, body?: unknown): Promise<T> {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'PUT',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(response);
  }

  async patch<T>(endpoint: string, body?: unknown): Promise<T> {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'PATCH',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(response);
  }

  async delete<T>(endpoint: string): Promise<T> {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
      headers,
    });
    return this.handleResponse<T>(response);
  }

  async uploadCsv<T>(endpoint: string, filename: string, content: string): Promise<T> {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'text/csv',
        'X-File-Name': encodeURIComponent(filename),
      },
      body: content,
    });
    return this.handleResponse<T>(response);
  }

  async download(endpoint: string): Promise<{ blob: Blob; filename: string | null }> {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'GET',
      headers,
    });

    if (response.status === 401) {
      keycloak.clearToken();
      throw new ApiError('Session expired', 401, 'SESSION_EXPIRED');
    }

    if (!response.ok) {
      let message = 'Download failed';
      let code: string | undefined;
      try {
        const data = (await response.json()) as ApiResponse<unknown>;
        message = data.error?.message ?? message;
        code = data.error?.code;
      } catch {
        // Non-JSON error response.
      }
      throw new ApiError(message, response.status, code);
    }

    const disposition = response.headers.get('Content-Disposition') ?? '';
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
    return { blob: await response.blob(), filename };
  }
}

export const api = new ApiClient();

class PublicApiClient {
  async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new ApiError('Request failed', response.status);
    }

    const data: ApiResponse<T> = await response.json();

    if (!data.success || !data.data) {
      throw new ApiError('Invalid response from server', response.status);
    }

    return data.data;
  }
}

export const publicApi = new PublicApiClient();
