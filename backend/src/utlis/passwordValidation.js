function validatePassword(password) {
  const errors = [];

  // Check if password exists
  if (!password || typeof password !== 'string' || password.trim().length === 0) {
    return { valid: false, errors: ['Password is required'] };
  }

  // Check length
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  // Check for capital letter
  if (!password.match(/[A-Z]/)) {
    errors.push('Password must contain at least one capital letter');
  }

  // Check for lowercase letter
  if (!password.match(/[a-z]/)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  // Check for number
  if (!password.match(/[0-9]/)) {
    errors.push('Password must contain at least one number');
  }

  // Check for special character
  if (!password.match(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/)) {
    errors.push('Password must contain at least one special character');
  }

  // Return result
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

export default validatePassword;
