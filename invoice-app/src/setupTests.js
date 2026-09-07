// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// No test may send real HTTP requests, even if an API URL is configured.
const blocked = () => { throw new Error('Network access is forbidden in frontend tests'); };
jest.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(blocked);
if (global.fetch) jest.spyOn(global, 'fetch').mockImplementation(blocked);

beforeEach(() => localStorage.clear());
