import { Button } from "@fluentui/react-components";

export const LIST_PAGE_SIZE = 20;

export function pageSlice<T>(items: T[], requestedPage: number) {
  const page = Math.min(
    Math.max(1, requestedPage),
    Math.max(1, Math.ceil(items.length / LIST_PAGE_SIZE)),
  );
  return {
    page,
    items: items.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE),
  };
}

export function ListPagination({
  page,
  total,
  onChange,
  label,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
  label: string;
}) {
  if (total <= LIST_PAGE_SIZE) return null;
  const pageCount = Math.ceil(total / LIST_PAGE_SIZE);
  return (
    <nav className="table-pagination" aria-label={`${label} pages`}>
      <span>
        {(page - 1) * LIST_PAGE_SIZE + 1}–
        {Math.min(page * LIST_PAGE_SIZE, total)} of {total}
      </span>
      <div>
        <Button disabled={page === 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <span>
          Page {page} of {pageCount}
        </span>
        <Button
          disabled={page === pageCount}
          onClick={() => onChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
