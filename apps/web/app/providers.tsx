"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";
import { Toaster } from "@/components/ui/sonner";
import { AnalyseJobProvider } from "@/components/analyse/analyse-job-context";
import { AnalyseJobDock } from "@/components/analyse/analyse-job-dock";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AnalyseJobProvider>
        {children}
        <AnalyseJobDock />
        <Toaster />
      </AnalyseJobProvider>
    </QueryClientProvider>
  );
}
