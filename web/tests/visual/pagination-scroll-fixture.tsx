import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Pagination } from '../../src/components/Pagination';
import { VerificationReportDetails } from '../../src/components/VerificationReportDetails';
import type { VerificationReport } from '../../../src/verification/types';

function Segment({ id }: { id: string }) {
  const target = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [loadedOffset, setLoadedOffset] = useState(0);
  return <section id={id}>
    <div ref={target} className="pagination-start" />
    <ul data-loaded-offset={loadedOffset}>
      {Array.from({ length: loadedOffset === 0 ? 20 : 5 }, (_, index) => <li key={index}>{loadedOffset + index + 1}</li>)}
    </ul>
    <Pagination limit={20} offset={offset} total={25} scrollTargetRef={target} onOffsetChange={next => {
      setOffset(next);
      setTimeout(() => setLoadedOffset(next), 200);
    }} />
  </section>;
}

const report = {
  findings: [], areas: [], sources: [], suggestions: [],
  limitations: Array.from({ length: 25 }, (_, index) => `Limitación ${index + 1}`),
} as unknown as VerificationReport;

createRoot(document.getElementById('root')!).render(<>
  <div className="spacer" />
  <Segment id="first" /><div className="spacer" /><Segment id="second" />
  <div className="spacer" /><VerificationReportDetails report={report} />
  <div className="spacer" />
</>);
