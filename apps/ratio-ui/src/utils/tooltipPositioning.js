// Smart tooltip positioning to prevent cutoff
export const handleTooltipPositioning = (indicator) => {
  const tooltip = indicator.querySelector('.tooltip');
  if (!tooltip) return;

  // Reset positioning classes (but preserve tooltip-below for vertical positioning)
  tooltip.classList.remove('tooltip-left-adjusted', 'tooltip-right-adjusted');

  // Force a reflow to get accurate measurements
  tooltip.offsetHeight;

  // Get positions after reset
  const indicatorRect = indicator.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const margin = 16; // Margin from viewport edge

  // Calculate if tooltip would extend beyond edges
  const tooltipWidth = tooltip.offsetWidth;
  const indicatorCenter = indicatorRect.left + indicatorRect.width / 2;
  const tooltipLeftEdge = indicatorCenter - tooltipWidth / 2;
  const tooltipRightEdge = indicatorCenter + tooltipWidth / 2;

  // Check horizontal positioning and apply classes
  // Note: We only handle horizontal adjustments; vertical positioning
  // is handled by CSS classes like 'tooltip-below'
  if (tooltipLeftEdge < margin) {
    tooltip.classList.add('tooltip-left-adjusted');
  } else if (tooltipRightEdge > viewportWidth - margin) {
    tooltip.classList.add('tooltip-right-adjusted');
  }
};

export const setupTooltipListeners = () => {
  // Store event handlers for cleanup
  const eventHandlers = new Map();

  // Add event listeners with improved positioning logic
  const rejectionIndicators = document.querySelectorAll('.rejection-indicator');

  rejectionIndicators.forEach((indicator) => {
    const handleMouseEnter = () => {
      // Multiple attempts to ensure proper positioning
      setTimeout(() => handleTooltipPositioning(indicator), 1);
      setTimeout(() => handleTooltipPositioning(indicator), 50);
      setTimeout(() => handleTooltipPositioning(indicator), 100);
    };

    const handleMouseLeave = () => {
      const tooltip = indicator.querySelector('.tooltip');
      if (tooltip) {
        // Reset positioning when tooltip disappears
        tooltip.classList.remove('tooltip-left-adjusted', 'tooltip-right-adjusted');
      }
    };

    eventHandlers.set(indicator, { handleMouseEnter, handleMouseLeave });
    indicator.addEventListener('mouseenter', handleMouseEnter);
    indicator.addEventListener('mouseleave', handleMouseLeave);
    indicator.addEventListener('focus', handleMouseEnter);
    indicator.addEventListener('blur', handleMouseLeave);
  });

  // Also handle window resize
  const handleResize = () => {
    rejectionIndicators.forEach((indicator) => {
      if (indicator.matches(':hover') || indicator.matches(':focus')) {
        handleTooltipPositioning(indicator);
      }
    });
  };

  window.addEventListener('resize', handleResize);

  // Return cleanup function
  return () => {
    window.removeEventListener('resize', handleResize);
    rejectionIndicators.forEach((indicator) => {
      const handlers = eventHandlers.get(indicator);
      if (handlers) {
        indicator.removeEventListener('mouseenter', handlers.handleMouseEnter);
        indicator.removeEventListener('mouseleave', handlers.handleMouseLeave);
        indicator.removeEventListener('focus', handlers.handleMouseEnter);
        indicator.removeEventListener('blur', handlers.handleMouseLeave);
      }
    });
  };
};
