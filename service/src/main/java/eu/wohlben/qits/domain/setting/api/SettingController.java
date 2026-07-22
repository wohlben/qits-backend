package eu.wohlben.qits.domain.setting.api;

import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.setting.control.SettingsService;
import eu.wohlben.qits.domain.setting.dto.SettingDto;
import eu.wohlben.qits.domain.setting.mapper.SettingMapper;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;

/**
 * The instance-settings boundary (qits-settings epic): read/write the generic DB-backed key/value
 * store. Values are plain strings; typed/enumerated keys (e.g. {@code agent.default-type}) validate
 * on write in {@link SettingsService} — an unknown value surfaces as a 400.
 */
@Path("/settings")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class SettingController {

  @Inject SettingsService settingsService;
  @Inject SettingMapper settingMapper;

  public static record ListSettingsRequest() {
    public record Response(List<Entry> entries) {
      public record Entry(SettingDto setting) {}
    }
  }

  @GET
  public ListSettingsRequest.Response list() {
    var entries =
        settingsService.list().stream()
            .map(s -> new ListSettingsRequest.Response.Entry(settingMapper.toDto(s)))
            .toList();
    return new ListSettingsRequest.Response(entries);
  }

  public static record GetSettingRequest() {
    public record Response(SettingDto setting) {}
  }

  @GET
  @Path("/{key}")
  public GetSettingRequest.Response get(@PathParam("key") String key) {
    var value =
        settingsService
            .get(key)
            .orElseThrow(() -> new NotFoundException("Setting not found: " + key));
    return new GetSettingRequest.Response(new SettingDto(key, value));
  }

  public static record UpdateSettingRequest(@NotNull String value) {
    public record Response(SettingDto setting) {}
  }

  @PUT
  @Path("/{key}")
  public UpdateSettingRequest.Response update(
      @PathParam("key") String key, @Valid UpdateSettingRequest request) {
    var setting = settingsService.set(key, request.value());
    return new UpdateSettingRequest.Response(settingMapper.toDto(setting));
  }
}
