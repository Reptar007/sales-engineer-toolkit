import { useState, useEffect } from 'react';

export const useReviewData = () => {
  const [reviewData, setReviewData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'pending', 'approved', 'rejected'
  const [showReview, setShowReview] = useState(false);
  const [showReviewData, setShowReviewData] = useState(false);

  // Search and filter logic
  useEffect(() => {
    let filtered = reviewData;

    // Apply status filter first
    if (statusFilter !== 'all') {
      filtered = filtered.filter((item) => item.status === statusFilter);
    }

    // Then apply search filter
    if (searchTerm) {
      filtered = filtered.filter(
        (item) =>
          item.testName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.reasoning.toLowerCase().includes(searchTerm.toLowerCase()),
      );
    }

    setFilteredData(filtered);
  }, [reviewData, searchTerm, statusFilter]);

  const handleSearch = (event) => {
    setSearchTerm(event.target.value);
  };

  const handleStatusFilter = (status) => {
    setStatusFilter(status);
  };

  const handleApprove = async (item) => {
    // Update local state immediately for better UX
    setReviewData((prevData) =>
      prevData.map((dataItem) =>
        dataItem.id === item.id ? { ...dataItem, status: 'approved' } : dataItem,
      ),
    );

    try {
      // Send approval to backend - for now just log it
      // The backend doesn't have a specific approval endpoint yet
      // TODO: Implement specific approval endpoint on backend if needed
    } catch (error) {
      console.error('Failed to send approval to backend:', error);
      // Revert local state if backend call fails
      setReviewData((prevData) =>
        prevData.map((dataItem) =>
          dataItem.id === item.id ? { ...dataItem, status: 'pending' } : dataItem,
        ),
      );
    }
  };

  const updateItemStatus = (id, status, rejectionReason = null, estimatedRatio = null) => {
    setReviewData((prevData) =>
      prevData.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              ...(rejectionReason && { rejectionReason }),
              ...(estimatedRatio && { estimatedRatio }),
            }
          : item,
      ),
    );
  };

  // Status counts for progress tracking (always from original data, not filtered)
  const statusCounts = reviewData.reduce(
    (counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    },
    { pending: 0, approved: 0, rejected: 0 },
  );

  const resetReviewData = () => {
    setReviewData([]);
    setSearchTerm('');
    setStatusFilter('all');
    setShowReview(false);
    setShowReviewData(false);
  };

  const resetDataOnly = () => {
    setReviewData([]);
    setSearchTerm('');
    setStatusFilter('all');
  };

  return {
    reviewData,
    setReviewData,
    filteredData,
    searchTerm,
    statusFilter,
    showReview,
    setShowReview,
    showReviewData,
    setShowReviewData,
    statusCounts,
    handleSearch,
    handleStatusFilter,
    handleApprove,
    updateItemStatus,
    resetReviewData,
    resetDataOnly,
  };
};
