import 'package:flutter/material.dart';
import 'package:openmusic/app/theme.dart';

/// NetEase-style dark dialogs & bottom sheets with correct text colors.
class OmDialog {
  OmDialog._();

  static Future<T?> showSheet<T>(
    BuildContext context, {
    required String title,
    String? subtitle,
    required Widget child,
    List<Widget>? actions,
  }) {
    return showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
          child: Container(
            margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            decoration: BoxDecoration(
              color: OmTheme.card,
              borderRadius: BorderRadius.circular(16),
            ),
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: Container(
                        width: 36,
                        height: 4,
                        margin: const EdgeInsets.only(bottom: 16),
                        decoration: BoxDecoration(
                          color: OmTheme.divider,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                        color: OmTheme.textPrimary,
                      ),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        subtitle,
                        style: const TextStyle(fontSize: 13, color: OmTheme.textSecondary),
                      ),
                    ],
                    const SizedBox(height: 18),
                    child,
                    if (actions != null) ...[
                      const SizedBox(height: 16),
                      ...actions,
                    ],
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  static Future<bool?> confirm(
    BuildContext context, {
    required String title,
    required String confirmLabel,
    String? subtitle,
    required Widget content,
  }) {
    return showSheet<bool>(
      context,
      title: title,
      subtitle: subtitle,
      child: content,
      actions: [
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('取消'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: Text(confirmLabel),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class OmField extends StatelessWidget {
  const OmField({
    super.key,
    required this.controller,
    this.label,
    this.hint,
    this.obscure = false,
    this.textCapitalization = TextCapitalization.none,
    this.focusNode,
    this.autofocus = false,
    this.onChanged,
  });

  final TextEditingController controller;
  final String? label;
  final String? hint;
  final bool obscure;
  final TextCapitalization textCapitalization;
  final FocusNode? focusNode;
  final bool autofocus;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      focusNode: focusNode,
      autofocus: autofocus,
      obscureText: obscure,
      textCapitalization: textCapitalization,
      onChanged: onChanged,
      style: const TextStyle(color: OmTheme.textPrimary, fontSize: 15),
      cursorColor: OmTheme.red,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        labelStyle: const TextStyle(color: OmTheme.textSecondary),
        hintStyle: const TextStyle(color: OmTheme.textHint),
        filled: true,
        fillColor: OmTheme.elevated,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: OmTheme.red, width: 1.2),
        ),
      ),
    );
  }
}

void omSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      ),
    );
}
