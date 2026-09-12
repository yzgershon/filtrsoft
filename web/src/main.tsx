/**
 * ⚠ `./migrate.ts` IS FIRST ON PURPOSE AND MUST STAY FIRST. It carries his
 * saved listings, history and device id across the 2026-09-04 rename, and ES
 * modules evaluate in import order — put it below `App.tsx` and a module-level
 * read beats it to the old key.
 */
import "./migrate.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import {LoadBoundary} from './load-boundary.tsx';
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><LoadBoundary><App /></LoadBoundary></StrictMode>,
);
