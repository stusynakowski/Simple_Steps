import '@testing-library/jest-dom';

// jsdom does not implement scrollIntoView — provide a no-op stub for tests
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};
}