/// <reference types="vite/client" />

declare global {
  namespace NodeJS {
    interface Timeout {}
    interface Timer {}
  }
}

export {};
