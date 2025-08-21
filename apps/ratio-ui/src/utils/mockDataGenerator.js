// Generate mock data based on file size (simulate API response)
export const generateMockData = () => {
  // Simulate variable data sizes based on random selection
  const sizes = [20, 50, 100, 200];
  const randomSize = sizes[Math.floor(Math.random() * sizes.length)];

  // Sample rejection reasons to demonstrate dynamic tooltip sizing
  const sampleRejections = [
    "Test coverage is insufficient and doesn't meet our quality standards",
    'This test case duplicates existing functionality and should be merged',
    'The test logic is flawed and produces false positives in edge cases',
    'Performance impact is too high for the value provided by this test',
    'Test dependencies are unclear and may cause maintenance issues down the line',
    "The assertions are too broad and don't validate specific behavior effectively",
    "This test requires external resources that aren't available in our CI environment",
  ];

  const mockData = [];
  for (let i = 1; i <= randomSize; i++) {
    const shouldReject = Math.random() < 0.15; // 15% chance of rejection
    const item = {
      id: i,
      testName: `Test ${i}`,
      ratio: `${Math.floor(Math.random() * 10) + 1}:${Math.floor(Math.random() * 10) + 1}`,
      reasoning: `Analysis for test ${i}: ${['High priority test case', 'Standard validation', 'Edge case scenario', 'Critical path test', 'Performance validation'][Math.floor(Math.random() * 5)]}`,
      status: shouldReject ? 'rejected' : 'pending',
    };

    // Add rejection reason for rejected items
    if (shouldReject) {
      item.rejectionReason = sampleRejections[Math.floor(Math.random() * sampleRejections.length)];
    }

    mockData.push(item);
  }
  return mockData;
};
