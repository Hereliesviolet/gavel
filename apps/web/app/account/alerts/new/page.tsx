"use client";

import { Suspense } from "react";
import { AlertForm } from "../alert-form";

export default function NewAlertPage() {
  return (
    <Suspense fallback={null}>
      <AlertForm />
    </Suspense>
  );
}
