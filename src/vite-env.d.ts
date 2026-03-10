/// <reference types="vite/client" />

// Provide NodeJS namespace for timer types used across the codebase
declare namespace NodeJS {
  type Timeout = ReturnType<typeof setTimeout>;
  type Timer = ReturnType<typeof setInterval>;
}
