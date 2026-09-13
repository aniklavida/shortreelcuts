/**
 * Registers jest-dom's matchers (`toBeDisabled`, etc.) and unmounts every
 * rendered component after each test — without `test.globals` on, none of
 * this is wired up automatically the way it is under Jest.
 */
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);
