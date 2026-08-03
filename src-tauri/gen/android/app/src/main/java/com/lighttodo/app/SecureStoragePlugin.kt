package com.lighttodo.app

import android.app.Activity
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class SecureStorageTargetArgs {
    lateinit var target: String
}

@InvokeArg
class SecureStorageWriteArgs {
    lateinit var target: String
    lateinit var secret: String
}

@TauriPlugin
class SecureStoragePlugin(private val activity: Activity) : Plugin(activity) {
    private val preferences by lazy {
        activity.getSharedPreferences("lighttodo_secure_storage", Context.MODE_PRIVATE)
    }

    private fun alias(target: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(target.toByteArray(StandardCharsets.UTF_8))
        return "lighttodo." + digest.joinToString("") { "%02x".format(it) }
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply {
        load(null)
    }

    private fun getOrCreateKey(target: String): SecretKey {
        val alias = alias(target)
        val keyStore = keyStore()
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        )
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    @Command
    fun read(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecureStorageTargetArgs::class.java)
            val result = JSObject()
            val stored = preferences.getString(alias(args.target), null)
            if (stored == null) {
                result.put("value", null)
                invoke.resolve(result)
                return
            }

            val parts = stored.split(":", limit = 2)
            require(parts.size == 2) { "Stored credential is malformed" }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(args.target),
                GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP))
            )
            cipher.updateAAD(args.target.toByteArray(StandardCharsets.UTF_8))
            val cleartext = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP))
            result.put("value", Base64.encodeToString(cleartext, Base64.NO_WRAP))
            cleartext.fill(0)
            invoke.resolve(result)
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to read secure credential")
        }
    }

    @Command
    fun write(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecureStorageWriteArgs::class.java)
            val cleartext = Base64.decode(args.secret, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(args.target))
            cipher.updateAAD(args.target.toByteArray(StandardCharsets.UTF_8))
            val ciphertext = cipher.doFinal(cleartext)
            cleartext.fill(0)
            val stored = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
                Base64.encodeToString(ciphertext, Base64.NO_WRAP)
            check(preferences.edit().putString(alias(args.target), stored).commit()) {
                "Failed to persist secure credential"
            }
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to write secure credential")
        }
    }

    @Command
    fun delete(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecureStorageTargetArgs::class.java)
            check(preferences.edit().remove(alias(args.target)).commit()) {
                "Failed to remove secure credential"
            }
            val keyStore = keyStore()
            val alias = alias(args.target)
            if (keyStore.containsAlias(alias)) {
                keyStore.deleteEntry(alias)
            }
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to delete secure credential")
        }
    }
}
