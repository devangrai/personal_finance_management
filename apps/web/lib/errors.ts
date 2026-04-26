type ErrorWithResponseData = {
  message?: string;
  response?: {
    data?: {
      error_message?: string;
      error_code?: string;
    };
  };
};

export function getErrorMessage(error: unknown, fallback: string) {
  const typedError = error as ErrorWithResponseData | undefined;

  return (
    typedError?.response?.data?.error_message ??
    typedError?.message ??
    fallback
  );
}
