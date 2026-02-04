"use client";

import React, { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

// This allows React to render PDFs without freezing the browser
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  file: string; 
  pageNumber: number;
  onClose: () => void;
}

export default function PDFViewer({
  file,
  pageNumber,
  onClose,
}: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState(1.0);
  const [currentPage, setCurrentPage] = useState(pageNumber);

  React.useEffect(() => {
    setCurrentPage(pageNumber);
  }, [pageNumber]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  return (
    <div className="h-full flex flex-col bg-slate-100 border-l border-slate-300 shadow-xl w-full max-w-2xl animate-in slide-in-from-right duration-300">
      {/* Header Controls */}
      <div className="bg-white border-b px-4 py-2 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-700 text-sm">
            Source Document
          </span>
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
            Page {currentPage} of {numPages}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs w-8 text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setScale((s) => Math.min(2.0, s + 0.1))}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="w-px h-4 bg-slate-300 mx-2" />
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="hover:bg-red-50 hover:text-red-600"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* PDF Rendering Area */}
      <div className="flex-1 overflow-auto p-8 flex justify-center">
        <Document
          file={file}
          onLoadSuccess={onDocumentLoadSuccess}
          className="shadow-lg"
        >
          <Page
            pageNumber={currentPage}
            scale={scale}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            className="border border-slate-200"
          />
        </Document>
      </div>

      {/* Footer Navigation */}
      <div className="bg-white border-t p-2 flex justify-center gap-4">
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => setCurrentPage((prev) => prev - 1)}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage >= numPages}
          onClick={() => setCurrentPage((prev) => prev + 1)}
        >
          Next <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
