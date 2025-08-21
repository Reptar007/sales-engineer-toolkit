import { useState, useEffect } from 'react';

export const useReviewData = () => {
  const [reviewData, setReviewData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [showReviewData, setShowReviewData] = useState(false);

  // Search and filter logic
  useEffect(() => {
    if (!searchTerm) {
      setFilteredData(reviewData);
    } else {
      const filtered = reviewData.filter(
        (item) =>
          item.testName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.reasoning.toLowerCase().includes(searchTerm.toLowerCase()),
      );
      setFilteredData(filtered);
    }
  }, [reviewData, searchTerm]);

  const handleSearch = (event) => {
    setSearchTerm(event.target.value);
  };

  const handleApprove = (item) => {
    setReviewData((prevData) =>
      prevData.map((dataItem) =>
        dataItem.id === item.id ? { ...dataItem, status: 'approved' } : dataItem,
      ),
    );
    // TODO: Send approve status to backend API
  };

  const updateItemStatus = (id, status, rejectionReason = null) => {
    setReviewData((prevData) =>
      prevData.map((item) =>
        item.id === id ? { ...item, status, ...(rejectionReason && { rejectionReason }) } : item,
      ),
    );
  };

  // Status counts for progress tracking
  const statusCounts = filteredData.reduce(
    (counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    },
    { pending: 0, approved: 0, rejected: 0 },
  );

  const resetReviewData = () => {
    setReviewData([]);
    setSearchTerm('');
    setShowReview(false);
    setShowReviewData(false);
  };

  const resetDataOnly = () => {
    setReviewData([]);
    setSearchTerm('');
  };

  return {
    reviewData,
    setReviewData,
    filteredData,
    searchTerm,
    showReview,
    setShowReview,
    showReviewData,
    setShowReviewData,
    statusCounts,
    handleSearch,
    handleApprove,
    updateItemStatus,
    resetReviewData,
    resetDataOnly,
  };
};
