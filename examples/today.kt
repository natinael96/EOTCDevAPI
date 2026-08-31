import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL

@Serializable data class Named(val amharic: String, val english: String? = null)
@Serializable data class Ethiopic(val date: String, val day: Int, val year: Int,
                                  val monthName: Named)
@Serializable data class Fasting(val isFasting: Boolean, val reason: String)
@Serializable data class Sinksar(val annual: List<String>, val monthly: List<String>)
@Serializable data class Today(val ethiopic: Ethiopic, val weekday: Named,
                               val fasting: Fasting, val sinksar: Sinksar? = null)

private val json = Json { ignoreUnknownKeys = true }

fun today(): Today {
    // Reckon the day in Addis Ababa, not from the device clock.
    val url = URL("https://eotcdev-api.natinael-96.workers.dev" +
        "/v1/today?tz=Africa/Addis_Ababa&include=sinksar")
    val connection = (url.openConnection() as HttpURLConnection).apply {
        setRequestProperty("User-Agent", "my-eotc-app/1.0")
        connectTimeout = 15_000
        readTimeout = 15_000
    }
    connection.inputStream.bufferedReader().use { reader ->
        return json.decodeFromString<Today>(reader.readText())
    }
}
