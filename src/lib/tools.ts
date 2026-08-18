import {
  Combine,
  FileCode,
  FileImage,
  FileText,
  ImagePlus,
  Minimize2,
  PenLine,
  RotateCw,
  Scissors,
  type LucideIcon,
} from "lucide-react";

export interface ToolDef {
  id: string;
  path: string;
  name: string;
  tagline: string;
  icon: LucideIcon;
  /** Accepted input MIME/extensions for the file picker. */
  accept: string;
  /** Whether processing happens fully in the browser. */
  clientSide: boolean;
  /** Whether the tool can accept a chained PDF output from another tool. */
  acceptsPdf: boolean;
  /** Tailwind classes for the tool's accent color. */
  accent: string;
}

export const TOOLS: ToolDef[] = [
  {
    id: "merge",
    path: "/merge",
    name: "Merge PDF",
    tagline: "Combine multiple PDFs into one, in the order you choose.",
    icon: Combine,
    accept: "application/pdf,.pdf",
    clientSide: true,
    acceptsPdf: true,
    accent: "bg-blue-50 text-blue-600",
  },
  {
    id: "split",
    path: "/split",
    name: "Split PDF",
    tagline: "Extract page ranges or burst into single pages.",
    icon: Scissors,
    accept: "application/pdf,.pdf",
    clientSide: true,
    acceptsPdf: true,
    accent: "bg-violet-50 text-violet-600",
  },
  {
    id: "compress",
    path: "/compress",
    name: "Compress PDF",
    tagline: "Shrink file size with three quality presets.",
    icon: Minimize2,
    accept: "application/pdf,.pdf",
    clientSide: true,
    acceptsPdf: true,
    accent: "bg-emerald-50 text-emerald-600",
  },
  {
    id: "pdf-to-image",
    path: "/pdf-to-image",
    name: "PDF to Image",
    tagline: "Export pages as PNG or JPG images.",
    icon: FileImage,
    accept: "application/pdf,.pdf",
    clientSide: true,
    acceptsPdf: true,
    accent: "bg-amber-50 text-amber-600",
  },
  {
    id: "image-to-pdf",
    path: "/image-to-pdf",
    name: "Image to PDF",
    tagline: "Combine JPG and PNG images into one PDF.",
    icon: ImagePlus,
    accept: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
    clientSide: true,
    acceptsPdf: false,
    accent: "bg-rose-50 text-rose-600",
  },
  {
    id: "rotate",
    path: "/rotate",
    name: "Rotate PDF",
    tagline: "Rotate any or all pages, with live thumbnails.",
    icon: RotateCw,
    accept: "application/pdf,.pdf",
    clientSide: true,
    acceptsPdf: true,
    accent: "bg-cyan-50 text-cyan-600",
  },
  {
    id: "word-to-pdf",
    path: "/word-to-pdf",
    name: "Word to PDF",
    tagline: "Convert .docx documents to PDF.",
    icon: FileText,
    accept:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx",
    clientSide: false,
    acceptsPdf: false,
    accent: "bg-indigo-50 text-indigo-600",
  },
  {
    id: "markdown-to-pdf",
    path: "/markdown-to-pdf",
    name: "Markdown to PDF",
    tagline: "Turn Markdown notes into a clean PDF.",
    icon: FileCode,
    accept: "text/markdown,text/plain,.md,.markdown,.txt",
    clientSide: true,
    acceptsPdf: false,
    accent: "bg-slate-100 text-slate-600",
  },
  {
    id: "sign",
    path: "/sign",
    name: "Sign PDF",
    tagline: "Draw, type, or upload a signature and place it on the page.",
    icon: PenLine,
    accept: "application/pdf,.pdf",
    clientSide: true,
    acceptsPdf: true,
    accent: "bg-teal-50 text-teal-600",
  },
];

export function toolById(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}
