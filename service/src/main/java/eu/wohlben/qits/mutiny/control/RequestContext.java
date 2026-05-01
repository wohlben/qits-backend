package eu.wohlben.qits.mutiny.control;

import jakarta.enterprise.context.RequestScoped;

@RequestScoped
public class RequestContext {
    private String traceId;

    public String getTraceId() {
        return traceId;
    }

    public void setTraceId(String traceId) {
        this.traceId = traceId;
    }
}
