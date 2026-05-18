interface MetricsState {
  requests_total: number;
  requests_by_status: Map<number, number>;
  latency_sum_ms: number;
  latency_count: number;
}

const state: MetricsState = {
  requests_total: 0,
  requests_by_status: new Map(),
  latency_sum_ms: 0,
  latency_count: 0,
};

export function recordRequest(statusCode: number, latencyMs: number): void {
  state.requests_total++;
  state.requests_by_status.set(statusCode, (state.requests_by_status.get(statusCode) ?? 0) + 1);
  state.latency_sum_ms += latencyMs;
  state.latency_count++;
}

export function getMetrics(): Readonly<MetricsState> {
  return state;
}
