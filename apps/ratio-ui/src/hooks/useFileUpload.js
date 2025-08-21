import { useState } from 'react';

export const useFileUpload = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const isCsvByName = (file) => {
    if (!file || !file.name) return false;
    return /\.csv$/i.test(file.name);
  };

  const handleFileChange = (event) => {
    const file = event?.target?.files?.[0];
    if (!file) {
      setSelectedFile(null);
      setErrorMessage('');
      return;
    }
    if (!isCsvByName(file)) {
      setErrorMessage('Please upload a .csv file');
      setSelectedFile(null);
      if (event?.target) event.target.value = '';
      return;
    }
    setErrorMessage('');
    setSelectedFile(file);
  };

  const resetFile = () => {
    setSelectedFile(null);
    setErrorMessage('');
    setIsLoading(false);
  };

  return {
    selectedFile,
    errorMessage,
    isLoading,
    setIsLoading,
    handleFileChange,
    resetFile,
    isCsvByName,
  };
};
