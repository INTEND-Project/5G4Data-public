import React, { useEffect, useRef } from 'react';
import InspectionDeck from './InspectionDeck';

const AgentPageClient = ({ agent }) => {
  const analyticsHandlersRef = useRef({
    trackAgentView: () => {},
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hostname === 'start5g-1.cs.uit.no') {
      return;
    }
    let cancelled = false;
    import('@/lib/analytics')
      .then((mod) => {
        if (cancelled) return;
        analyticsHandlersRef.current.trackAgentView = mod.trackAgentView ?? (() => {});
      })
      .catch(() => {
        // No-op: analytics should never block UI hydration.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (agent?.id) analyticsHandlersRef.current.trackAgentView(agent);
  }, [agent]);

  const handleClose = () => {
    window.location.href = '/';
  };

  return <InspectionDeck agent={agent} onClose={handleClose} />;
};

export default AgentPageClient;
