import { useState } from 'react';

export const usePagination = (data, itemsPerPage = 25) => {
  const [currentPage, setCurrentPage] = useState(1);

  // Pagination calculations
  const totalPages = Math.ceil(data.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = data.slice(startIndex, endIndex);

  // Determine display strategy based on data size
  const shouldUsePagination = data.length > 30;
  const shouldUseScrollableContainer = data.length > 10 && data.length <= 30;

  // Reset to first page when data changes
  const resetPage = () => setCurrentPage(1);

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  return {
    currentPage,
    totalPages,
    currentItems,
    shouldUsePagination,
    shouldUseScrollableContainer,
    setCurrentPage,
    resetPage,
    handlePageChange,
  };
};
