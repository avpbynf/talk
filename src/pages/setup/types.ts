export interface ModelInfo {
  id: string;
  name: string;
  size_mb: number;
  description: string;
}

export interface GpuInfo {
  vendor: string;
  name: string;
  available: boolean;
  description: string;
}

export interface DownloadProgress {
  model_id: string;
  progress: number;
  downloaded_mb: number;
  total_mb: number;
}

export type TranscriptionMode = "local" | "server";
export type GpuVendor = "vulkan" | "metal" | "cpu";
export type ModelFamily = "standard" | "quantized";

/** The name the wizard gives an acceleration, here and in the summary. */
export function gpuLabel(vendor: GpuVendor): string {
  if (vendor === "vulkan") return "AMD/Intel Vulkan";
  if (vendor === "metal") return "Apple Metal";
  return "CPU";
}
