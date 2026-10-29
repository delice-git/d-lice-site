const PATHS = {
  home: <><path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 9v11.5h13V9" /><path d="M10 20.5v-6h4v6" /></>,
  orders: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2.8h6V4" /><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  book: <><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" /><path d="M9 7.5h6" /></>,
  box: <><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></>,
  bread: <><path d="M5 11.5a7 7 0 0 1 14 0V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" /><path d="M9 9l1.5 1.5M12.5 7.5 14 9" /></>,
  store: <><path d="M4 9h16l-1.6-5H5.6z" /><path d="M5 9v11.5h14V9" /><path d="M10 20.5v-5h4v5" /></>,
  leaf: <><path d="M5 19.5C5 11 10 5 20 4.5c0 10-6 15-14 15" /><path d="M5 19.5l8-8" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20.5a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2a6 6 0 0 1 3.5 6.3" /></>,
  more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.9 0-1-1-1.6-1-2.6s.9-1.5 2-1.5h2a4 4 0 0 0 4-4C21 6.4 17 3 12 3z" /><circle cx="7.5" cy="11" r="1.1" /><circle cx="10.5" cy="7" r="1.1" /><circle cx="15.2" cy="7.6" r="1.1" /></>,
  logout: <><path d="M14 4h5v16h-5" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  history: <><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /><path d="M12 8v4.5l3 2" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  print: <><path d="M7 9V3.5h10V9" /><rect x="3.5" y="9" width="17" height="8" rx="2" /><path d="M7 14h10v6.5H7z" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2.8h6V4" /><path d="M8.5 13l2.5 2.5 4.5-5" /></>,
}

export function Icon({ name, size = 22, stroke = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  )
}
