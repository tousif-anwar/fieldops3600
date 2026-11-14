import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@fluentui/react-components";
import { Bell, Check } from "lucide-react";
import { api, post } from "../api";
import { dateTime, humanize } from "../format";
import {
  Empty,
  ErrorState,
  InlineMessage,
  Loading,
  PageHeader,
  Panel,
  Status,
} from "../components/common";
import { ListPagination, pageSlice } from "../components/ListPagination";
import type { Notification } from "../types";

export function Notifications() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const result = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<Notification[]>("/api/notifications"),
    refetchInterval: 30000,
  });
  const rows = pageSlice(result.data ?? [], page);
  const acknowledge = useMutation({
    mutationFn: (id: string) =>
      post(`/api/notifications/${id}/acknowledge`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  return (
    <>
      <PageHeader title="Notifications" />
      <Panel>
        {result.isPending ? (
          <Loading />
        ) : result.isError ? (
          <ErrorState
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : !result.data?.length ? (
          <Empty
            title="No notifications"
            description="Assignment and service alerts will appear here."
          />
        ) : (
          <div className="notification-list">
            {rows.items.map((n) => (
              <article
                key={n.id}
                className={n.acknowledgedAtUtc ? "acknowledged" : ""}
              >
                <span className="notification-icon">
                  <Bell aria-hidden="true" size={20} />
                </span>
                <div>
                  <strong>
                    {n.title ?? humanize(n.eventType ?? "Service update")}
                  </strong>
                  <p>{n.message ?? `Work order ${n.workOrderId}`}</p>
                  <small>{dateTime(n.createdAtUtc)}</small>
                </div>
                {n.acknowledgedAtUtc ? (
                  <Status value="Acknowledged" />
                ) : (
                  <Button
                    icon={<Check aria-hidden="true" size={16} />}
                    disabled={acknowledge.isPending}
                    onClick={() => acknowledge.mutate(n.id)}
                  >
                    Acknowledge
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
        {result.isSuccess && (
          <ListPagination
            page={rows.page}
            total={result.data.length}
            onChange={setPage}
            label="Notifications"
          />
        )}
        {acknowledge.isError && (
          <InlineMessage>{acknowledge.error.message}</InlineMessage>
        )}
      </Panel>
    </>
  );
}
