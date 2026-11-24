using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Nexo PokeBot")]
[assembly: AssemblyDescription("Nexo PokeBot: Hub multi-contas e automacao desenvolvidos especificamente para o PokeIdle")]
[assembly: AssemblyProduct("Nexo PokeBot")]
[assembly: AssemblyCompany("Nexo")]
[assembly: AssemblyVersion("1.0.8.0")]
[assembly: AssemblyFileVersion("1.0.8.0")]

namespace PokeBotDesktop
{
    internal static class Theme
    {
        public static readonly Color BgWindow = Color.FromArgb(10, 15, 25);
        public static readonly Color BgCard = Color.FromArgb(20, 28, 43);
        public static readonly Color BgTile = Color.FromArgb(14, 21, 34);
        public static readonly Color BgInput = Color.FromArgb(12, 19, 32);
        public static readonly Color BgHover = Color.FromArgb(26, 38, 60);
        public static readonly Color BorderSubtle = Color.FromArgb(30, 41, 59);
        public static readonly Color BorderInput = Color.FromArgb(45, 59, 85);

        public static readonly Color TextPrimary = Color.FromArgb(241, 245, 249);
        public static readonly Color TextMuted = Color.FromArgb(148, 163, 184);
        public static readonly Color TextDim = Color.FromArgb(135, 151, 174);

        public static readonly Color Blue = Color.FromArgb(37, 99, 235);
        public static readonly Color BlueLight = Color.FromArgb(96, 165, 250);
        public static readonly Color Green = Color.FromArgb(16, 185, 129);
        public static readonly Color GreenBright = Color.FromArgb(74, 222, 128);
        public static readonly Color Teal = Color.FromArgb(13, 148, 136);
        public static readonly Color Amber = Color.FromArgb(245, 158, 11);
        public static readonly Color Red = Color.FromArgb(239, 68, 68);
        public static readonly Color Purple = Color.FromArgb(124, 58, 237);

        public static GraphicsPath RoundedRect(Rectangle r, int radius)
        {
            var path = new GraphicsPath();
            int d = Math.Max(2, radius * 2);
            if (d > r.Width) d = r.Width;
            if (d > r.Height) d = r.Height;
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        public static Color AdjustBrightness(Color c, int delta)
        {
            int r = Math.Max(0, Math.Min(255, c.R + delta));
            int g = Math.Max(0, Math.Min(255, c.G + delta));
            int b = Math.Max(0, Math.Min(255, c.B + delta));
            return Color.FromArgb(c.A, r, g, b);
        }
    }

    internal sealed class RoundedCard : Panel
    {
        public string CardTitle { get; set; }
        public int CornerRadius { get; set; }
        public Color FillColor { get; set; }
        public Color BorderColor { get; set; }

        public RoundedCard()
        {
            CornerRadius = 13;
            FillColor = Theme.BgCard;
            BorderColor = Theme.BorderSubtle;
            BackColor = Theme.BgWindow;
            DoubleBuffered = true;
            ResizeRedraw = true;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var bgBrush = new SolidBrush(Theme.BgWindow))
            {
                g.FillRectangle(bgBrush, ClientRectangle);
            }

            Rectangle rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using (GraphicsPath path = Theme.RoundedRect(rect, CornerRadius))
            using (var fill = new SolidBrush(FillColor))
            using (var pen = new Pen(BorderColor, 1f))
            {
                g.FillPath(fill, path);
                g.DrawPath(pen, path);
            }

            if (!string.IsNullOrEmpty(CardTitle))
            {
                using (var font = new Font("Segoe UI", 10f, FontStyle.Bold))
                {
                    TextRenderer.DrawText(
                        g,
                        CardTitle,
                        font,
                        new Rectangle(16, 12, Math.Max(40, Width - 32), 22),
                        Theme.TextPrimary,
                        TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis
                    );
                }
            }
        }
    }

    internal sealed class PillButton : Control
    {
        private bool _hover;
        private bool _pressed;
        private Color _bgColor = Theme.BgTile;
        private Color _borderColor = Theme.BorderInput;
        private int _radius = 7;

        public Color BgColor
        {
            get { return _bgColor; }
            set { _bgColor = value; Invalidate(); }
        }

        public Color BorderColor
        {
            get { return _borderColor; }
            set { _borderColor = value; Invalidate(); }
        }

        public int CornerRadius
        {
            get { return _radius; }
            set { _radius = value; Invalidate(); }
        }

        public PillButton()
        {
            DoubleBuffered = true;
            Cursor = Cursors.Hand;
            AccessibleRole = AccessibleRole.PushButton;
            ForeColor = Theme.TextPrimary;
            Font = new Font("Segoe UI", 8.6f, FontStyle.Bold);
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }

        protected override void OnTextChanged(EventArgs e)
        {
            base.OnTextChanged(e);
            Invalidate();
        }

        protected override void OnEnabledChanged(EventArgs e)
        {
            base.OnEnabledChanged(e);
            Invalidate();
        }

        protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { _hover = false; _pressed = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) { _pressed = true; Invalidate(); } base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { _pressed = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
        protected override bool IsInputKey(Keys keyData)
        {
            return keyData == Keys.Enter || base.IsInputKey(keyData);
        }
        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Space || e.KeyCode == Keys.Enter) e.Handled = true;
            base.OnKeyDown(e);
        }
        protected override void OnKeyUp(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Space || e.KeyCode == Keys.Enter)
            {
                e.Handled = true;
                OnClick(EventArgs.Empty);
            }
            base.OnKeyUp(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            Color fill = !Enabled
                ? Theme.BgTile
                : (_pressed ? Theme.AdjustBrightness(_bgColor, -14) : (_hover ? Theme.AdjustBrightness(_bgColor, 16) : _bgColor));
            Color border = !Enabled ? Theme.BorderSubtle : (Focused ? Theme.TextPrimary : (_hover ? Theme.AdjustBrightness(_borderColor, 26) : _borderColor));
            Color txt = !Enabled ? Theme.TextDim : ForeColor;

            Rectangle rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using (GraphicsPath path = Theme.RoundedRect(rect, _radius))
            using (var br = new SolidBrush(fill))
            using (var pen = new Pen(border, 1f))
            {
                g.FillPath(br, path);
                g.DrawPath(pen, path);
            }

            int hPad = Width <= 30 ? 0 : 6;
            TextFormatFlags flags = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix;
            if (Width > 30) flags |= TextFormatFlags.EndEllipsis;
            TextRenderer.DrawText(
                g,
                Text ?? "",
                Font,
                new Rectangle(hPad, 0, Math.Max(4, Width - hPad * 2), Height),
                txt,
                flags
            );
        }
    }

    internal sealed class StatusPill : Control
    {
        private Color _dotColor = Theme.Amber;
        private Color _pillBg = Color.FromArgb(30, 41, 59);

        public StatusPill()
        {
            DoubleBuffered = true;
            Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            ForeColor = Theme.Amber;
            Text = "INICIANDO";
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }

        public void SetStatus(string label, Color accent, Color bgTint)
        {
            Text = label;
            _dotColor = accent;
            ForeColor = accent;
            _pillBg = bgTint;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using (GraphicsPath path = Theme.RoundedRect(rect, Height / 2))
            using (var br = new SolidBrush(_pillBg))
            using (var pen = new Pen(Color.FromArgb(90, _dotColor), 1f))
            {
                g.FillPath(br, path);
                g.DrawPath(pen, path);
            }

            int dotSize = 7;
            using (var dotBr = new SolidBrush(_dotColor))
            {
                g.FillEllipse(dotBr, 9, (Height - dotSize) / 2, dotSize, dotSize);
            }

            TextRenderer.DrawText(
                g,
                Text ?? "",
                Font,
                new Rectangle(19, 0, Math.Max(10, Width - 24), Height),
                ForeColor,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis
            );
        }
    }

    internal sealed class DarkToggleSwitch : Control
    {
        private bool _checked;
        private bool _hover;
        private Color _onColor = Theme.Green;

        public event EventHandler CheckedChanged;

        public bool Checked
        {
            get { return _checked; }
            set
            {
                if (_checked == value) return;
                _checked = value;
                Invalidate();
                EventHandler h = CheckedChanged;
                if (h != null) h(this, EventArgs.Empty);
            }
        }

        public Color OnColor
        {
            get { return _onColor; }
            set { _onColor = value; Invalidate(); }
        }

        public void SetCheckedQuiet(bool val)
        {
            if (_checked != val)
            {
                _checked = val;
                Invalidate();
            }
        }

        public DarkToggleSwitch()
        {
            DoubleBuffered = true;
            Cursor = Cursors.Hand;
            AccessibleRole = AccessibleRole.CheckButton;
            Font = new Font("Segoe UI", 9f);
            ForeColor = Theme.TextPrimary;
            Height = 24;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }

        protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { _hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnClick(EventArgs e) { Checked = !Checked; base.OnClick(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
        protected override void OnKeyUp(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Space)
            {
                e.Handled = true;
                OnClick(EventArgs.Empty);
            }
            base.OnKeyUp(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            int trackW = 32;
            int trackH = 17;
            int trackY = (Height - trackH) / 2;
            Rectangle track = new Rectangle(1, trackY, trackW, trackH);

            Color trackColor = _checked
                ? (_hover ? Theme.AdjustBrightness(_onColor, 14) : _onColor)
                : (_hover ? Color.FromArgb(51, 65, 85) : Color.FromArgb(37, 48, 68));

            using (GraphicsPath p = Theme.RoundedRect(track, trackH / 2))
            using (var br = new SolidBrush(trackColor))
            {
                g.FillPath(br, p);
            }

            int knobSize = 13;
            int knobX = _checked ? (track.Right - knobSize - 2) : (track.X + 2);
            int knobY = trackY + 2;
            using (var knobBr = new SolidBrush(_checked ? Color.White : Color.FromArgb(203, 213, 225)))
            {
                g.FillEllipse(knobBr, knobX, knobY, knobSize, knobSize);
            }

            TextRenderer.DrawText(
                g,
                Text ?? "",
                Font,
                new Rectangle(trackW + 9, 0, Math.Max(10, Width - trackW - 10), Height),
                _checked ? Theme.TextPrimary : Theme.TextMuted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis
            );
            if (Focused) ControlPaint.DrawFocusRectangle(g, ClientRectangle);
        }
    }

    internal sealed class DarkComboBox : ComboBox
    {
        private const int WM_PAINT = 0x000F;
        private bool _hover;

        public string Placeholder { get; set; }

        public DarkComboBox()
        {
            DropDownStyle = ComboBoxStyle.DropDownList;
            DrawMode = DrawMode.OwnerDrawFixed;
            FlatStyle = FlatStyle.Flat;
            BackColor = Theme.BgInput;
            ForeColor = Theme.TextPrimary;
            Font = new Font("Segoe UI", 8.8f);
            ItemHeight = 20;
        }

        protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { _hover = false; Invalidate(); base.OnMouseLeave(e); }

        protected override void OnDrawItem(DrawItemEventArgs e)
        {
            if (e.Index < 0 || e.Index >= Items.Count) return;
            bool selected = (e.State & DrawItemState.Selected) == DrawItemState.Selected;
            Color bg = selected ? Theme.Blue : Theme.BgInput;
            Color fg = selected ? Color.White : Theme.TextPrimary;

            using (var br = new SolidBrush(bg))
            {
                e.Graphics.FillRectangle(br, e.Bounds);
            }
            string txt = GetItemText(Items[e.Index]);
            TextRenderer.DrawText(
                e.Graphics,
                txt,
                Font,
                new Rectangle(e.Bounds.X + 6, e.Bounds.Y, Math.Max(10, e.Bounds.Width - 10), e.Bounds.Height),
                fg,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis
            );
        }

        protected override void WndProc(ref Message m)
        {
            base.WndProc(ref m);
            if (m.Msg == WM_PAINT)
            {
                using (Graphics g = Graphics.FromHwnd(Handle))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
                    using (var bg = new SolidBrush(Theme.BgInput))
                    {
                        g.FillRectangle(bg, ClientRectangle);
                    }
                    using (GraphicsPath path = Theme.RoundedRect(r, 6))
                    using (var fill = new SolidBrush(Theme.BgInput))
                    using (var pen = new Pen(Focused || DroppedDown ? Theme.Blue : (_hover ? Color.FromArgb(71, 85, 105) : Theme.BorderInput), 1f))
                    {
                        g.FillPath(fill, path);
                        g.DrawPath(pen, path);
                    }

                    string txt = SelectedItem != null ? GetItemText(SelectedItem) : Placeholder ?? "";
                    TextRenderer.DrawText(
                        g,
                        txt,
                        Font,
                        new Rectangle(8, 0, Math.Max(10, Width - 28), Height),
                        SelectedItem != null ? Theme.TextPrimary : Theme.TextMuted,
                        TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis
                    );

                    int cx = Width - 14;
                    int cy = Height / 2 - 2;
                    using (var pen = new Pen(Theme.TextMuted, 1.6f))
                    {
                        g.DrawLine(pen, cx - 4, cy, cx, cy + 4);
                        g.DrawLine(pen, cx, cy + 4, cx + 4, cy);
                    }
                }
            }
        }
    }

    internal sealed class DarkStepper : Control
    {
        private readonly TextBox _input;
        private readonly PillButton _btnDec;
        private readonly PillButton _btnInc;
        private long _min;
        private long _max = 100;
        private long _step = 1;
        private long _value;
        private bool _updating;

        public event EventHandler ValueChanged;

        public long Minimum { get { return _min; } set { _min = value; SetValueQuiet(_value); } }
        public long Maximum { get { return _max; } set { _max = value; SetValueQuiet(_value); } }
        public long Increment { get { return _step; } set { _step = Math.Max(1, value); } }

        public long Value
        {
            get { return _value; }
            set
            {
                long clamped = Math.Max(_min, Math.Min(_max, value));
                bool changed = clamped != _value;
                _value = clamped;
                SyncText();
                if (changed && !_updating)
                {
                    EventHandler h = ValueChanged;
                    if (h != null) h(this, EventArgs.Empty);
                }
            }
        }

        public void SetValueQuiet(long val)
        {
            _updating = true;
            _value = Math.Max(_min, Math.Min(_max, val));
            SyncText();
            _updating = false;
        }

        public DarkStepper()
        {
            DoubleBuffered = true;
            BackColor = Theme.BgCard;
            Height = 26;

            _btnDec = new PillButton
            {
                Text = "-",
                BgColor = Theme.BgTile,
                BorderColor = Theme.BorderSubtle,
                CornerRadius = 5,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
            };
            _btnInc = new PillButton
            {
                Text = "+",
                BgColor = Theme.BgTile,
                BorderColor = Theme.BorderSubtle,
                CornerRadius = 5,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
            };
            _input = new TextBox
            {
                BorderStyle = BorderStyle.None,
                BackColor = Theme.BgInput,
                ForeColor = Theme.TextPrimary,
                TextAlign = HorizontalAlignment.Center,
                Font = new Font("Segoe UI", 8.8f, FontStyle.Bold),
            };

            _btnDec.Click += (s, e) => { Value = _value - _step; };
            _btnInc.Click += (s, e) => { Value = _value + _step; };
            _input.Leave += (s, e) => CommitInput();
            _input.KeyDown += (s, e) =>
            {
                if (e.KeyCode == Keys.Enter)
                {
                    CommitInput();
                    e.SuppressKeyPress = true;
                }
            };

            Controls.Add(_btnDec);
            Controls.Add(_input);
            Controls.Add(_btnInc);
            Resize += (s, e) => LayoutParts();
            LayoutParts();
        }

        private void CommitInput()
        {
            long parsed;
            if (long.TryParse((_input.Text ?? "").Replace(".", "").Replace(",", "").Trim(), out parsed))
            {
                Value = parsed;
            }
            else
            {
                SyncText();
            }
        }

        private void SyncText()
        {
            string s = _value.ToString();
            if (_input.Text != s) _input.Text = s;
        }

        private void LayoutParts()
        {
            int btnW = 22;
            int innerH = Math.Max(18, Height - 4);
            _btnDec.Bounds = new Rectangle(2, 2, btnW, innerH);
            _btnInc.Bounds = new Rectangle(Math.Max(btnW + 4, Width - btnW - 2), 2, btnW, innerH);
            int txtW = Math.Max(20, Width - (btnW * 2) - 8);
            _input.Bounds = new Rectangle(btnW + 4, (Height - 16) / 2 + 1, txtW, 16);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using (GraphicsPath path = Theme.RoundedRect(rect, 6))
            using (var br = new SolidBrush(Theme.BgInput))
            using (var pen = new Pen(Theme.BorderInput, 1f))
            {
                g.FillPath(br, path);
                g.DrawPath(pen, path);
            }
        }
    }

    internal sealed class HpBarControl : Control
    {
        private int _percent;
        private string _labelText = "0 / 0 HP";

        public HpBarControl()
        {
            DoubleBuffered = true;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        }

        public void SetHp(int percent, string label)
        {
            _percent = Math.Max(0, Math.Min(100, percent));
            _labelText = label ?? "";
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using (GraphicsPath track = Theme.RoundedRect(rect, 7))
            using (var bg = new SolidBrush(Theme.BgTile))
            using (var border = new Pen(Theme.BorderSubtle, 1f))
            {
                g.FillPath(bg, track);
                g.DrawPath(border, track);
            }

            int fillW = (int)Math.Round((Width - 4) * (_percent / 100.0));
            if (fillW > 4)
            {
                Color c1 = _percent > 55 ? Color.FromArgb(16, 185, 129) : (_percent > 25 ? Color.FromArgb(245, 158, 11) : Color.FromArgb(239, 68, 68));
                Color c2 = _percent > 55 ? Color.FromArgb(5, 150, 105) : (_percent > 25 ? Color.FromArgb(217, 119, 6) : Color.FromArgb(185, 28, 28));
                Rectangle fillRect = new Rectangle(2, 2, fillW, Height - 4);
                using (GraphicsPath fp = Theme.RoundedRect(fillRect, 5))
                using (var br = new LinearGradientBrush(fillRect, c1, c2, 90f))
                {
                    g.FillPath(br, fp);
                }
            }

            using (var font = new Font("Segoe UI", 8.2f, FontStyle.Bold))
            {
                TextRenderer.DrawText(
                    g,
                    _labelText,
                    font,
                    ClientRectangle,
                    Color.White,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix
                );
            }
        }
    }

    internal sealed class KpiTile : Panel
    {
        public Color AccentColor { get; set; }
        public Label LblTitle { get; private set; }
        public Label LblValue { get; private set; }
        public Label LblSub { get; private set; }

        public KpiTile(string title, Color accent)
        {
            AccentColor = accent;
            DoubleBuffered = true;
            ResizeRedraw = true;
            BackColor = Theme.BgCard;

            LblTitle = new Label
            {
                Text = title.ToUpperInvariant(),
                Location = new Point(10, 9),
                Size = new Size(160, 14),
                ForeColor = Theme.TextDim,
                BackColor = Color.Transparent,
                Font = new Font("Segoe UI", 7.3f, FontStyle.Bold),
                UseMnemonic = false,
            };
            LblValue = new Label
            {
                Text = "0",
                Location = new Point(10, 25),
                Size = new Size(160, 26),
                ForeColor = Theme.TextPrimary,
                BackColor = Color.Transparent,
                Font = new Font("Segoe UI", 14.5f, FontStyle.Bold),
                UseMnemonic = false,
            };
            LblSub = new Label
            {
                Text = "-",
                Location = new Point(10, 52),
                Size = new Size(160, 16),
                ForeColor = Theme.TextMuted,
                BackColor = Color.Transparent,
                Font = new Font("Segoe UI", 7.8f),
                UseMnemonic = false,
            };

            Controls.Add(LblTitle);
            Controls.Add(LblValue);
            Controls.Add(LblSub);
            Resize += (s, e) =>
            {
                int w = Math.Max(40, Width - 18);
                LblTitle.Width = w;
                LblValue.Width = w;
                LblSub.Width = w;
            };
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using (GraphicsPath path = Theme.RoundedRect(rect, 8))
            using (var fill = new SolidBrush(Theme.BgTile))
            using (var pen = new Pen(Theme.BorderSubtle, 1f))
            {
                g.FillPath(fill, path);
                g.DrawPath(pen, path);
            }

            Rectangle accentBar = new Rectangle(10, 1, Math.Max(20, Width - 20), 2);
            using (var br = new SolidBrush(AccentColor))
            {
                g.FillRectangle(br, accentBar);
            }
        }
    }

    internal sealed class SpriteFrame : Panel
    {
        private Image _sprite;

        public SpriteFrame()
        {
            DoubleBuffered = true;
            ResizeRedraw = true;
            BackColor = Theme.BgCard;
        }

        public void SetSprite(Image img)
        {
            _sprite = img;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.NearestNeighbor;
            Rectangle rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using (GraphicsPath path = Theme.RoundedRect(rect, 9))
            using (var br = new SolidBrush(Theme.BgTile))
            using (var pen = new Pen(Theme.BorderInput, 1f))
            {
                g.FillPath(br, path);
                g.DrawPath(pen, path);
            }

            if (_sprite != null)
            {
                int pad = 4;
                g.DrawImage(_sprite, new Rectangle(pad, pad, Width - pad * 2, Height - pad * 2));
            }
            else
            {
                int r = Math.Min(Width, Height) - 20;
                int x = (Width - r) / 2;
                int y = (Height - r) / 2;
                using (var red = new SolidBrush(Color.FromArgb(220, 38, 38)))
                using (var white = new SolidBrush(Color.FromArgb(226, 232, 240)))
                using (var dark = new SolidBrush(Theme.BgTile))
                {
                    g.FillPie(red, x, y, r, r, 180, 180);
                    g.FillPie(white, x, y, r, r, 0, 180);
                    g.FillRectangle(dark, x, y + r / 2 - 2, r, 4);
                    g.FillEllipse(dark, x + r / 2 - 6, y + r / 2 - 6, 12, 12);
                    g.FillEllipse(white, x + r / 2 - 3, y + r / 2 - 3, 6, 6);
                }
            }
        }
    }

    internal sealed class HuntItem
    {
        public string Slug { get; set; }
        public string Label { get; set; }
        public override string ToString() { return Label ?? Slug ?? ""; }
    }

    internal sealed class ProfileItem
    {
        public string Id { get; set; }
        public string Label { get; set; }
        public override string ToString() { return Label ?? Id ?? ""; }
    }

    public sealed class PokeBotMainForm : Form
    {
        private readonly int _account;
        private int ServerPort { get { return 17889 + _account; } }
        private string BaseUrl { get { return "http://127.0.0.1:" + ServerPort; } }

        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
        private readonly object _pollLock = new object();
        private readonly Dictionary<string, Image> _spriteCache = new Dictionary<string, Image>();

        private System.Threading.Timer _pollTimer;
        private Process _nodeProcess;
        private bool _ownsNodeProcess;
        private bool _isClosing;
        private bool _configDirty;
        private string _backendError;
        private int _lastLogId;
        private string _lastHuntSignature = "";
        private string _lastHuntGuideAlert = "";
        private string _lastSpriteKey = "";
        private string _projectRoot;
        private NotifyIcon _trayIcon;

        // Containers
        private RoundedCard _headerCard;
        private RoundedCard _pokeCard;
        private RoundedCard _metricsCard;
        private RoundedCard _invCard;
        private RoundedCard _cfgCard;
        private RoundedCard _logCard;

        // Header controls
        private Label _lblTitle;
        private StatusPill _statusPill;
        private Label _lblTrainerLine;
        private PillButton _btnStart;
        private PillButton _btnPause;
        private PillButton _btnToggleGame;
        private PillButton _btnLinkedGame;
        private PillButton _btnWeb;
        private PillButton _btnTray;

        private enum Page { Overview, Automation, Connections, Activity }
        private Page _page;
        private Panel _workspace;
        private Panel _pageContent;
        private Panel[] _pages;
        private readonly List<PillButton> _navigation = new List<PillButton>();
        private Label _pageTitle;
        private Label _pageDescription;
        private RoundedCard _quickCard;
        private RoundedCard _connectionCard;
        private RoundedCard _settingsCard;
        private Label _configHint;
        private Label _pokeLoginState;
        private Label _twitchLoginState;
        private Label _kickLoginState;
        private bool _loadingConfig;
        private bool _savingConfig;

        // Active Pokemon & Hunt
        private SpriteFrame _spriteFrame;
        private Label _lblActivePoke;
        private HpBarControl _hpBar;
        private Label _lblHuntInfo;
        private DarkComboBox _cmbHunts;
        private PillButton _btnChangeHunt;

        // KPIs
        private KpiTile _kpiKills;
        private KpiTile _kpiXp;
        private KpiTile _kpiGold;
        private KpiTile _kpiCaps;

        // Inventory & Lives
        private readonly List<Panel> _invChips = new List<Panel>();
        private Label _invPoke;
        private Label _invGreat;
        private Label _invSuper;
        private Label _invUltra;
        private Label _invBeast;
        private Label _invPotion;
        private Label _invRevive;
        private Panel _livesBox;
        private Label _lblLivesHead;
        private Label _lblLivesTw;
        private Label _lblLivesKk;

        // Config controls
        private DarkToggleSwitch _chkCaidos;
        private DarkToggleSwitch _chkEconomy;
        private DarkToggleSwitch _chkEconomyPingOnly;
        private DarkToggleSwitch _chkStandby;
        private DarkToggleSwitch _chkRestock;
        private DarkToggleSwitch _chkPass;
        private DarkToggleSwitch _chkPrey;
        private DarkToggleSwitch _chkNativeHeal;
        private DarkToggleSwitch _chkLives;

        private Label _lblBallNormal;
        private Label _lblBallShiny;
        private Label _lblTargetBalls;
        private Label _lblTargetPotions;
        private Label _lblTargetRevives;
        private Label _lblReserveGold;
        private Label _lblLiveReward;
        private Label _lblLiveTwSlots;
        private Label _lblLiveKkSlots;
        private Label _lblGuideMode;
        private Label _lblGuideMetric;

        private DarkComboBox _cmbBallNormal;
        private DarkComboBox _cmbBallShiny;
        private DarkComboBox _cmbLiveReward;
        private DarkComboBox _cmbGuideMode;
        private DarkComboBox _cmbGuideMetric;
        private static readonly string[] GuideModes = { "off", "notify", "auto" };
        private static readonly string[] GuideMetrics = { "xp", "ouro", "shiny" };
        private DarkStepper _numTargetBalls;
        private DarkStepper _numTargetPotions;
        private DarkStepper _numTargetRevives;
        private DarkStepper _numReserveGold;
        private DarkStepper _numLiveTwitchSlots;
        private DarkStepper _numLiveKickSlots;

        private PillButton _btnLoginTwitch;
        private PillButton _btnLoginKick;
        private PillButton _btnLoginPokeIdle;
        private PillButton _btnRestockNow;
        private PillButton _btnPassNow;
        private PillButton _btnPreyNow;
        private PillButton _btnLivesNow;
        private PillButton _btnSaveCfg;

        // Logs & Game toolbar
        private Label _lblBrowserProfile;
        private DarkComboBox _cmbBrowserProfile;
        private PillButton _btnImportLiveTokens;
        private PillButton _btnImportSession;
        private PillButton _btnReloadSess;
        private string _lastProfileSignature = "";
        private bool _loadingProfile;
        private string _currentLoginInProgress = "";
        private Panel _logWrapper;
        private RichTextBox _rtbLogs;


        // Win32 Interop
        [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
        [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
        [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        private const int DWMWA_USE_IMMERSIVE_DARK_MODE_OLD = 19;
        private const int DWMWA_CAPTION_COLOR = 35;

        public PokeBotMainForm(int account)
        {
            _account = account;
            Text = "Nexo PokeBot v1.0 - Conta " + account;
            Size = new Size(1140, 790);
            MinimumSize = new Size(920, 680);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Theme.BgWindow;
            ForeColor = Theme.TextPrimary;
            Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            DoubleBuffered = true;

            _projectRoot = FindProjectRoot();
            LoadAppIcon();
            BuildUi();

            HandleCreated += (s, e) => EnableDarkTitleBar();
            Resize += (s, e) =>
            {
                if (WindowState != FormWindowState.Minimized)
                {
                    LayoutContent();
                }
            };
            Shown += (s, e) =>
            {
                EnableDarkTitleBar();
                LayoutContent();
                SetupTrayIcon();
                StartBackendAndPolling();
            };
            FormClosing += OnMainFormClosing;
        }

        private void EnableDarkTitleBar()
        {
            try
            {
                int useDark = 1;
                if (DwmSetWindowAttribute(Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref useDark, 4) != 0)
                {
                    DwmSetWindowAttribute(Handle, DWMWA_USE_IMMERSIVE_DARK_MODE_OLD, ref useDark, 4);
                }
                int captionBgr = 0x001A0E09; // #090E1A
                DwmSetWindowAttribute(Handle, DWMWA_CAPTION_COLOR, ref captionBgr, 4);
            }
            catch { }
        }

        private void LoadAppIcon()
        {
            try
            {
                Icon exeIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (exeIcon != null) { Icon = exeIcon; return; }
            }
            catch { }

            if (!string.IsNullOrEmpty(_projectRoot))
            {
                string[] iconCandidates = new[]
                {
                    Path.Combine(_projectRoot, "assets", "nexo-pokebot.ico"),
                    Path.Combine(_projectRoot, "dist", "nexo-pokebot.ico"),
                    Path.Combine(_projectRoot, "dist", "pokebot.ico"),
                };
                foreach (string ico in iconCandidates)
                {
                    if (File.Exists(ico))
                    {
                        try { Icon = new Icon(ico); break; }
                        catch { }
                    }
                }
            }
        }

        private static Label MakeFieldLabel(string text, Control parent)
        {
            var lbl = new Label
            {
                Text = text,
                ForeColor = Theme.TextMuted,
                BackColor = Color.Transparent,
                Font = new Font("Segoe UI", 7.8f, FontStyle.Bold),
                UseMnemonic = false,
            };
            parent.Controls.Add(lbl);
            return lbl;
        }

        private Label AddInvChip(Control parent, string name)
        {
            var chip = new Panel { BackColor = Theme.BgTile };
            var lblName = new Label
            {
                Text = name,
                Location = new Point(9, 5),
                Size = new Size(110, 17),
                ForeColor = Theme.TextMuted,
                BackColor = Color.Transparent,
                Font = new Font("Segoe UI", 8.2f),
                UseMnemonic = false,
            };
            var lblVal = new Label
            {
                Text = "0",
                ForeColor = Theme.TextPrimary,
                BackColor = Color.Transparent,
                Font = new Font("Segoe UI", 8.8f, FontStyle.Bold),
                TextAlign = ContentAlignment.MiddleRight,
                UseMnemonic = false,
            };
            chip.Controls.Add(lblName);
            chip.Controls.Add(lblVal);
            chip.Resize += (s, e) =>
            {
                lblName.Width = Math.Max(40, chip.Width - 78);
                lblVal.Bounds = new Rectangle(Math.Max(50, chip.Width - 72), 4, 64, 19);
            };
            parent.Controls.Add(chip);
            _invChips.Add(chip);
            return lblVal;
        }

        private void BuildUi()
        {
            _headerCard = new RoundedCard { BorderColor = Theme.BorderInput };
            _lblTitle = new Label
            {
                Text = "PokeBot",
                Font = new Font("Segoe UI", 18f, FontStyle.Bold),
                ForeColor = Theme.TextPrimary,
                BackColor = Color.Transparent,
                UseMnemonic = false,
            };
            _statusPill = new StatusPill();
            _lblTrainerLine = new Label
            {
                Text = "Conta " + _account + "  ·  Conectando ao servidor local…",
                ForeColor = Theme.TextMuted,
                BackColor = Color.Transparent,
                Font = new Font("Segoe UI", 9f),
                AutoEllipsis = true,
                UseMnemonic = false,
            };

            _btnStart = new PillButton { Text = "Iniciar bot", BgColor = Theme.Blue, BorderColor = Theme.BlueLight };
            _btnPause = new PillButton { Text = "Pausar bot" };
            _btnToggleGame = new PillButton { Text = "Abrir jogo" };
            _btnLinkedGame = new PillButton { Text = "Jogar com o bot", BgColor = Theme.Blue, BorderColor = Theme.BlueLight };
            _btnWeb = new PillButton { Text = "Painel web" };
            _btnTray = new PillButton { Text = "Minimizar para bandeja" };

            _btnStart.Click += (s, e) => SendActionAsync("start");
            _btnPause.Click += (s, e) => SendActionAsync("pause");
            _btnToggleGame.Click += (s, e) => SendActionAsync("open-game");
            _btnLinkedGame.Click += (s, e) => SendActionAsync("play-with-bot");
            _btnWeb.Click += (s, e) => OpenWebPanel();
            _btnTray.Click += (s, e) => MinimizeToTray();

            _headerCard.Controls.AddRange(new Control[]
            {
                _lblTitle, _statusPill, _lblTrainerLine, _btnStart, _btnPause, _btnToggleGame, _btnLinkedGame
            });
            Controls.Add(_headerCard);

            string[] pageNames = { "Visão geral", "Automação", "Conexões", "Atividade" };
            for (int i = 0; i < pageNames.Length; i++)
            {
                Page page = (Page)i;
                var button = new PillButton { Text = pageNames[i], Font = new Font("Segoe UI", 10f, FontStyle.Bold) };
                button.Click += (s, e) => ShowPage(page);
                _navigation.Add(button);
                Controls.Add(button);
            }
            Controls.AddRange(new Control[] { _btnWeb, _btnTray });

            _pageTitle = MakeFieldLabel("", this);
            _pageTitle.Font = new Font("Segoe UI", 20f, FontStyle.Bold);
            _pageTitle.ForeColor = Theme.TextPrimary;
            _pageDescription = MakeFieldLabel("", this);
            _pageDescription.Font = new Font("Segoe UI", 9f);

            _workspace = new Panel { AutoScroll = true };
            _pageContent = new Panel();
            _pages = new Panel[pageNames.Length];
            for (int i = 0; i < _pages.Length; i++)
            {
                _pages[i] = new Panel { Dock = DockStyle.Fill, Visible = false };
                _pageContent.Controls.Add(_pages[i]);
            }
            _workspace.Controls.Add(_pageContent);
            Controls.Add(_workspace);

            _pokeCard = new RoundedCard { CardTitle = "Pokémon ativo e hunt" };
            _spriteFrame = new SpriteFrame();
            _lblActivePoke = new Label
            {
                Text = "Aguardando Pokémon",
                Font = new Font("Segoe UI", 11.5f, FontStyle.Bold),
                ForeColor = Theme.TextPrimary,
                BackColor = Color.Transparent,
                UseMnemonic = false,
            };
            _hpBar = new HpBarControl();
            _lblHuntInfo = new Label
            {
                Text = "Hunt atual: -",
                ForeColor = Theme.TextMuted,
                BackColor = Color.Transparent,
                Font = new Font("Segoe UI", 8.4f),
                AutoEllipsis = true,
                UseMnemonic = false,
            };
            _cmbHunts = new DarkComboBox { AccessibleName = "Escolher hunt", Placeholder = "Escolher hunt" };
            _btnChangeHunt = new PillButton { Text = "Trocar hunt", Enabled = false };
            _cmbHunts.SelectedIndexChanged += (s, e) => _btnChangeHunt.Enabled = _cmbHunts.SelectedItem is HuntItem;
            _btnChangeHunt.Click += (s, e) =>
            {
                var item = _cmbHunts.SelectedItem as HuntItem;
                if (item != null && !string.IsNullOrEmpty(item.Slug))
                {
                    SendActionAsync("set-hunt", new Dictionary<string, object> { { "slug", item.Slug } });
                }
            };
            _pokeCard.Controls.AddRange(new Control[] { _spriteFrame, _lblActivePoke, _hpBar, _lblHuntInfo, _cmbHunts, _btnChangeHunt });

            _metricsCard = new RoundedCard { CardTitle = "Desempenho da sessão" };
            _kpiKills = new KpiTile("Abates", Theme.Green);
            _kpiXp = new KpiTile("XP Ganho", Theme.BlueLight);
            _kpiGold = new KpiTile("Gold Ganho", Theme.Amber);
            _kpiCaps = new KpiTile("Capturas", Theme.Purple);
            _metricsCard.Controls.AddRange(new Control[] { _kpiKills, _kpiXp, _kpiGold, _kpiCaps });

            _invCard = new RoundedCard { CardTitle = "Mochila" };
            _invPoke = AddInvChip(_invCard, "Poke Ball");
            _invGreat = AddInvChip(_invCard, "Great Ball");
            _invSuper = AddInvChip(_invCard, "Super Ball");
            _invUltra = AddInvChip(_invCard, "Ultra Ball");
            _invBeast = AddInvChip(_invCard, "Beast Ball");
            _invPotion = AddInvChip(_invCard, "Small Potion");
            _invRevive = AddInvChip(_invCard, "Revive");

            _livesBox = new RoundedCard { CardTitle = "Recompensas de lives" };
            _lblLivesHead = new Label
            {
                Text = "Aguardando dados de recompensas…",
                ForeColor = Theme.TextPrimary,
                BackColor = Color.Transparent,
                Font = new Font("Segoe UI", 8.2f, FontStyle.Bold),
                UseMnemonic = false,
            };
            _lblLivesTw = new Label
            {
                Text = "Twitch: verificando...",
                ForeColor = Color.FromArgb(196, 181, 253),
                BackColor = Color.Transparent,
                Font = new Font("Segoe UI", 8f),
                UseMnemonic = false,
            };
            _lblLivesKk = new Label
            {
                Text = "Kick: verificando...",
                ForeColor = Color.FromArgb(134, 239, 172),
                BackColor = Color.Transparent,
                Font = new Font("Segoe UI", 8f),
                UseMnemonic = false,
            };
            _livesBox.Controls.AddRange(new Control[] { _lblLivesHead, _lblLivesTw, _lblLivesKk });

            _cfgCard = new RoundedCard { CardTitle = "Rotinas automáticas" };
            _settingsCard = new RoundedCard { CardTitle = "Preferências e limites" };
            _quickCard = new RoundedCard { CardTitle = "Ações rápidas" };
            _connectionCard = new RoundedCard { CardTitle = "Contas vinculadas" };
            _chkCaidos = new DarkToggleSwitch { Text = "Capturar Pokémon caídos" };
            _chkEconomy = new DarkToggleSwitch { Text = "Ativar economia do servidor" };
            _chkEconomyPingOnly = new DarkToggleSwitch { Text = "Só enviar ping no modo economia", OnColor = Theme.Teal };
            _chkStandby = new DarkToggleSwitch { Text = "Entrar em espera no erro 4001" };
            _chkRestock = new DarkToggleSwitch { Text = "Repor itens no mercado" };
            _chkPass = new DarkToggleSwitch { Text = "Resgatar o passe diário" };
            _chkPrey = new DarkToggleSwitch { Text = "Rolar o Prey diário" };
            _chkNativeHeal = new DarkToggleSwitch { Text = "Usar cura e Revive do jogo" };
            _chkLives = new DarkToggleSwitch { Text = "Coletar recompensas de lives", OnColor = Theme.Purple };

            _cfgCard.Controls.AddRange(new Control[]
            {
                _chkCaidos, _chkNativeHeal, _chkRestock, _chkPass, _chkPrey, _chkLives, _chkEconomy, _chkEconomyPingOnly, _chkStandby
            });

            _lblBallNormal = MakeFieldLabel("Bola para captura comum", _settingsCard);
            _cmbBallNormal = new DarkComboBox();
            _cmbBallNormal.Items.AddRange(new object[] { "auto", "poke", "great", "super", "ultra", "beast" });

            _lblBallShiny = MakeFieldLabel("Bola para shiny", _settingsCard);
            _cmbBallShiny = new DarkComboBox();
            _cmbBallShiny.Items.AddRange(new object[] { "best", "beast", "ultra", "super", "great", "poke" });

            _lblTargetBalls = MakeFieldLabel("Estoque alvo de bolas", _settingsCard);
            _numTargetBalls = new DarkStepper { Minimum = 10, Maximum = 5000, Increment = 10, Value = 50 };

            _lblTargetPotions = MakeFieldLabel("Estoque alvo de poções", _settingsCard);
            _numTargetPotions = new DarkStepper { Minimum = 0, Maximum = 5000, Increment = 10, Value = 40 };

            _lblTargetRevives = MakeFieldLabel("Estoque alvo de revives", _settingsCard);
            _numTargetRevives = new DarkStepper { Minimum = 0, Maximum = 5000, Increment = 5, Value = 20 };

            _lblReserveGold = MakeFieldLabel("Reserva mínima de gold", _settingsCard);
            _numReserveGold = new DarkStepper { Minimum = 0, Maximum = 100000000, Increment = 5000, Value = 0 };

            _lblLiveReward = MakeFieldLabel("Bônus das lives", _settingsCard);
            _cmbLiveReward = new DarkComboBox();
            _cmbLiveReward.Items.AddRange(new object[] { "xp", "captura", "shiny" });

            _lblLiveTwSlots = MakeFieldLabel("Lives na Twitch", _settingsCard);
            _numLiveTwitchSlots = new DarkStepper { Minimum = 1, Maximum = 12, Increment = 1, Value = 4 };

            _lblLiveKkSlots = MakeFieldLabel("Lives na Kick", _settingsCard);
            _numLiveKickSlots = new DarkStepper { Minimum = 1, Maximum = 12, Increment = 1, Value = 2 };
            _lblGuideMode = MakeFieldLabel("Acompanhamento /hunt", _settingsCard);
            _lblGuideMetric = MakeFieldLabel("Prioridade do /hunt", _settingsCard);
            _cmbGuideMode = new DarkComboBox();
            _cmbGuideMode.Items.AddRange(new object[] { "Desligado", "Avisar", "Trocar automaticamente" });
            _cmbGuideMetric = new DarkComboBox();
            _cmbGuideMetric.Items.AddRange(new object[] { "XP/h", "Ouro/h", "Shiny/h" });
            _settingsCard.Controls.AddRange(new Control[] { _cmbGuideMode, _cmbGuideMetric });

            _btnLoginTwitch = new PillButton { Text = "Conectar Twitch" };
            _btnLoginKick = new PillButton { Text = "Conectar Kick" };
            _btnLoginPokeIdle = new PillButton { Text = "Logar PokeIdle", BgColor = Theme.Blue, BorderColor = Theme.BlueLight };
            _lblBrowserProfile = MakeFieldLabel("Perfil do navegador", _connectionCard);
            _cmbBrowserProfile = new DarkComboBox { AccessibleName = "Perfil do navegador", Placeholder = "Perfil isolado desta conta" };
            _cmbBrowserProfile.SelectedIndexChanged += (s, e) =>
            {
                if (_loadingProfile) return;
                var item = _cmbBrowserProfile.SelectedItem as ProfileItem;
                if (item != null)
                {
                    SendActionAsync("set-config", new Dictionary<string, object>
                    {
                        { "config", new Dictionary<string, object> { { "browserProfile", item.Id ?? "" } } }
                    });
                }
            };
            _pokeLoginState = MakeFieldLabel("PokeIdle", _connectionCard);
            _twitchLoginState = MakeFieldLabel("Twitch", _connectionCard);
            _kickLoginState = MakeFieldLabel("Kick", _connectionCard);

            _btnLoginTwitch.Click += (s, e) =>
            {
                if (_currentLoginInProgress == "twitch") SendActionAsync("cancel-login");
                else SendActionAsync("login-twitch", new Dictionary<string, object> { { "interactive", true } });
            };
            _btnLoginKick.Click += (s, e) =>
            {
                if (_currentLoginInProgress == "kick") SendActionAsync("cancel-login");
                else SendActionAsync("login-kick", new Dictionary<string, object> { { "interactive", true } });
            };
            _btnLoginPokeIdle.Click += (s, e) =>
            {
                if (_currentLoginInProgress == "pokeidle")
                {
                    SendActionAsync("cancel-login");
                }
                else
                {
                    SendActionAsync("login-pokeidle", new Dictionary<string, object> { { "interactive", true } });
                }
            };

            _btnRestockNow = new PillButton { Text = "Repor itens" };
            _btnPassNow = new PillButton { Text = "Resgatar passe" };
            _btnPreyNow = new PillButton { Text = "Rolar Prey" };
            _btnLivesNow = new PillButton { Text = "Coletar das lives" };
            _btnSaveCfg = new PillButton { Text = "Salvar alterações", BgColor = Theme.Blue, BorderColor = Theme.BlueLight, Enabled = false };

            _btnRestockNow.Click += (s, e) => SendActionAsync("restock-now");
            _btnPassNow.Click += (s, e) => SendActionAsync("claim-pass");
            _btnPreyNow.Click += (s, e) => SendActionAsync("roll-prey");
            _btnLivesNow.Click += (s, e) => SendActionAsync("run-lives");
            _btnSaveCfg.Click += (s, e) => SaveConfig();

            EventHandler dirtyHandler = (s, e) => { if (!_loadingConfig) SetConfigDirty(true); };
            foreach (var sw in new[] { _chkCaidos, _chkEconomy, _chkEconomyPingOnly, _chkStandby, _chkRestock, _chkPass, _chkPrey, _chkNativeHeal, _chkLives })
            {
                sw.CheckedChanged += dirtyHandler;
            }
            _cmbBallNormal.SelectedIndexChanged += dirtyHandler;
            _cmbGuideMode.SelectedIndexChanged += dirtyHandler;
            _cmbGuideMetric.SelectedIndexChanged += dirtyHandler;
            _cmbBallShiny.SelectedIndexChanged += dirtyHandler;
            _cmbLiveReward.SelectedIndexChanged += dirtyHandler;
            _numTargetBalls.ValueChanged += dirtyHandler;
            _numTargetPotions.ValueChanged += dirtyHandler;
            _numTargetRevives.ValueChanged += dirtyHandler;
            _numReserveGold.ValueChanged += dirtyHandler;
            _numLiveTwitchSlots.ValueChanged += dirtyHandler;
            _numLiveKickSlots.ValueChanged += dirtyHandler;

            _settingsCard.Controls.AddRange(new Control[]
            {
                _cmbBallNormal, _cmbBallShiny, _cmbLiveReward,
                _numTargetBalls, _numTargetPotions, _numTargetRevives, _numReserveGold, _numLiveTwitchSlots, _numLiveKickSlots
            });

            _logCard = new RoundedCard { CardTitle = "Registro de eventos" };
            _btnImportLiveTokens = new PillButton { Text = "Colar token Twitch/Kick" };
            _btnImportLiveTokens.Click += (s, e) => ShowImportLiveTokensDialog();
            _btnImportSession = new PillButton { Text = "Colar sessão" };
            _btnImportSession.Click += (s, e) => ShowImportSessionDialog();
            _btnReloadSess = new PillButton { Text = "Recarregar sessão" };
            _btnReloadSess.Click += (s, e) => SendActionAsync("reload-session");

            _logWrapper = new Panel { BackColor = Color.FromArgb(7, 11, 20), Padding = new Padding(6) };
            _rtbLogs = new RichTextBox
            {
                Dock = DockStyle.Fill,
                ReadOnly = true,
                BorderStyle = BorderStyle.None,
                BackColor = Color.FromArgb(7, 11, 20),
                ForeColor = Theme.TextPrimary,
                Font = new Font("Consolas", 8.6f),
                WordWrap = true,
                DetectUrls = false,
                ScrollBars = RichTextBoxScrollBars.Vertical,
                Text = "Os eventos da sessão aparecem aqui.",
            };
            _logWrapper.Controls.Add(_rtbLogs);
            _logCard.Controls.Add(_logWrapper);

            _quickCard.Controls.AddRange(new Control[] { _btnRestockNow, _btnPassNow, _btnPreyNow, _btnLivesNow });
            _connectionCard.Controls.AddRange(new Control[] { _cmbBrowserProfile, _btnLoginPokeIdle, _btnLoginTwitch, _btnLoginKick, _btnImportLiveTokens, _btnImportSession, _btnReloadSess });
            _pages[(int)Page.Overview].Controls.AddRange(new Control[] { _pokeCard, _metricsCard, _invCard, _quickCard });
            var automation = _pages[(int)Page.Automation];
            automation.Controls.AddRange(new Control[] { _cfgCard, _settingsCard, _btnSaveCfg });
            _configHint = MakeFieldLabel("", automation);
            _configHint.Font = new Font("Segoe UI", 9f);
            SetConfigDirty(false);
            _pages[(int)Page.Connections].Controls.AddRange(new Control[] { _connectionCard, _livesBox });
            _pages[(int)Page.Activity].Controls.Add(_logCard);
            ShowPage(Page.Overview);
        }

        private void ShowPage(Page page)
        {
            _page = page;
            for (int i = 0; i < _pages.Length; i++)
            {
                bool selected = i == (int)page;
                _pages[i].Visible = selected;
                _navigation[i].BgColor = selected ? Color.FromArgb(30, 54, 93) : Theme.BgTile;
                _navigation[i].BorderColor = selected ? Theme.BlueLight : Theme.BorderSubtle;
            }

            _pageTitle.Text = _navigation[(int)page].Text;
            switch (page)
            {
                case Page.Overview:
                    _pageDescription.Text = "Acompanhe a hunt, o desempenho e os itens da conta.";
                    break;
                case Page.Automation:
                    _pageDescription.Text = "Escolha as rotinas do bot e ajuste os limites de cada uma.";
                    break;
                case Page.Connections:
                    _pageDescription.Text = "Gerencie as contas do jogo e das plataformas de live.";
                    break;
                case Page.Activity:
                    _pageDescription.Text = "Acompanhe comandos, recompensas e avisos da sessão.";
                    break;
            }
            _workspace.AutoScrollPosition = Point.Empty;
            LayoutContent();
        }

        private void LayoutContent()
        {
            const int pad = 16;
            const int gap = 12;
            const int navWidth = 158;
            const int workspaceTop = 172;
            int width = ClientSize.Width;
            int height = ClientSize.Height;
            if (width < 400 || height < 300) return;

            SuspendLayout();
            try
            {
                _headerCard.Bounds = new Rectangle(pad, pad, width - pad * 2, 74);
                LayoutHeader(_headerCard.Width);

                for (int i = 0; i < _navigation.Count; i++)
                    _navigation[i].Bounds = new Rectangle(pad, 108 + i * 43, navWidth, 36);

                _btnWeb.Bounds = new Rectangle(pad, height - 95, navWidth, 36);
                _btnTray.Bounds = new Rectangle(pad, height - 52, navWidth, 36);

                int pageX = pad + navWidth + 20;
                int pageW = width - pageX - pad;
                int pageH = height - workspaceTop - pad;
                _pageTitle.Bounds = new Rectangle(pageX, 103, pageW, 38);
                _pageDescription.Bounds = new Rectangle(pageX + 2, 143, pageW - 2, 20);
                _workspace.Bounds = new Rectangle(pageX, workspaceTop, pageW, pageH);

                int minHeight = _page == Page.Activity ? 200 : _page == Page.Automation ? 488 : _page == Page.Connections ? 480 : 430;
                int contentHeight = Math.Max(pageH, minHeight);
                int contentWidth = pageW - (contentHeight > pageH ? SystemInformation.VerticalScrollBarWidth : 0);
                _pageContent.Size = new Size(contentWidth, contentHeight);
                _workspace.AutoScrollMinSize = new Size(0, contentHeight);

                int leftW = (contentWidth - gap) / 2;
                int rightX = leftW + gap;
                int rightW = contentWidth - rightX;
                switch (_page)
                {
                    case Page.Overview:
                        _pokeCard.Bounds = new Rectangle(0, 0, leftW, 222);
                        _metricsCard.Bounds = new Rectangle(rightX, 0, rightW, 222);
                        _invCard.Bounds = new Rectangle(0, 234, leftW, 196);
                        _quickCard.Bounds = new Rectangle(rightX, 234, rightW, 196);
                        LayoutPokeCard(leftW);
                        LayoutMetricsCard(rightW);
                        LayoutInventory(leftW);
                        LayoutQuickActions(rightW);
                        break;
                    case Page.Automation:
                        _cfgCard.Bounds = new Rectangle(0, 0, leftW, 378);
                        _settingsCard.Bounds = new Rectangle(rightX, 0, rightW, 438);
                        LayoutAutomation(leftW, rightW);
                        _btnSaveCfg.Bounds = new Rectangle(contentWidth - 162, 450, 162, 36);
                        _configHint.Bounds = new Rectangle(2, 458, contentWidth - 180, 20);
                        break;
                    case Page.Connections:
                        _connectionCard.Bounds = new Rectangle(0, 0, contentWidth, 286);
                        _livesBox.Bounds = new Rectangle(0, 298, contentWidth, 172);
                        LayoutConnections(contentWidth);
                        break;
                    case Page.Activity:
                        _logCard.Bounds = new Rectangle(0, 0, contentWidth, contentHeight);
                        _logWrapper.Bounds = new Rectangle(pad, 46, contentWidth - pad * 2, contentHeight - 62);
                        break;
                }
            }
            finally
            {
                ResumeLayout(true);
            }
        }

        private void LayoutHeader(int width)
        {
            _lblTitle.Bounds = new Rectangle(16, 9, 112, 32);
            _statusPill.Bounds = new Rectangle(134, 14, 130, 25);
            _lblTrainerLine.Bounds = new Rectangle(17, 44, width - 504, 20);

            _btnStart.Bounds = new Rectangle(width - 327, 19, 97, 36);
            _btnPause.Bounds = new Rectangle(width - 222, 19, 97, 36);
            _btnToggleGame.Bounds = new Rectangle(width - 117, 19, 101, 36);
            _btnLinkedGame.Bounds = new Rectangle(width - 474, 19, 139, 36);
        }

        private void LayoutPokeCard(int width)
        {
            _spriteFrame.Bounds = new Rectangle(16, 49, 74, 74);
            int infoWidth = width - 120;
            _lblActivePoke.Bounds = new Rectangle(104, 51, infoWidth, 25);
            _hpBar.Bounds = new Rectangle(104, 83, infoWidth, 21);
            _lblHuntInfo.Bounds = new Rectangle(16, 135, width - 32, 20);
            _cmbHunts.Bounds = new Rectangle(16, 170, width - 145, 32);
            _btnChangeHunt.Bounds = new Rectangle(width - 121, 169, 105, 32);
        }

        private void LayoutMetricsCard(int width)
        {
            int tileWidth = (width - 42) / 2;
            int secondX = 26 + tileWidth;
            _kpiKills.Bounds = new Rectangle(16, 46, tileWidth, 76);
            _kpiXp.Bounds = new Rectangle(secondX, 46, width - secondX - 16, 76);
            _kpiGold.Bounds = new Rectangle(16, 131, tileWidth, 76);
            _kpiCaps.Bounds = new Rectangle(secondX, 131, width - secondX - 16, 76);
        }

        private void LayoutInventory(int width)
        {
            int tileWidth = (width - 40) / 2;
            for (int i = 0; i < _invChips.Count; i++)
            {
                int x = 16 + i % 2 * (tileWidth + 8);
                _invChips[i].Bounds = new Rectangle(x, 46 + i / 2 * 34, tileWidth, 27);
            }
        }

        private void LayoutQuickActions(int width)
        {
            int tileWidth = (width - 42) / 2;
            int secondX = 26 + tileWidth;
            _btnRestockNow.Bounds = new Rectangle(16, 49, tileWidth, 53);
            _btnPassNow.Bounds = new Rectangle(secondX, 49, width - secondX - 16, 53);
            _btnPreyNow.Bounds = new Rectangle(16, 113, tileWidth, 53);
            _btnLivesNow.Bounds = new Rectangle(secondX, 113, width - secondX - 16, 53);
        }

        private void LayoutAutomation(int leftWidth, int rightWidth)
        {
            Control[] switches = { _chkCaidos, _chkNativeHeal, _chkRestock, _chkPass, _chkPrey, _chkLives,
                _chkEconomy, _chkEconomyPingOnly, _chkStandby };
            for (int i = 0; i < switches.Length; i++)
                switches[i].Bounds = new Rectangle(16, 46 + i * 33 + (i >= 6 ? 13 : 0), leftWidth - 32, 26);

            int colWidth = (rightWidth - 44) / 2;
            int secondX = 28 + colWidth;
            LayoutSetting(_lblBallNormal, _cmbBallNormal, 16, 48, colWidth);
            LayoutSetting(_lblBallShiny, _cmbBallShiny, secondX, 48, colWidth);
            LayoutSetting(_lblTargetBalls, _numTargetBalls, 16, 110, colWidth);
            LayoutSetting(_lblTargetPotions, _numTargetPotions, secondX, 110, colWidth);
            LayoutSetting(_lblReserveGold, _numReserveGold, 16, 172, colWidth);
            LayoutSetting(_lblTargetRevives, _numTargetRevives, secondX, 172, colWidth);
            LayoutSetting(_lblLiveReward, _cmbLiveReward, 16, 248, colWidth);
            LayoutSetting(_lblLiveTwSlots, _numLiveTwitchSlots, 16, 310, colWidth);
            LayoutSetting(_lblLiveKkSlots, _numLiveKickSlots, secondX, 310, colWidth);
            LayoutSetting(_lblGuideMode, _cmbGuideMode, 16, 372, colWidth);
            LayoutSetting(_lblGuideMetric, _cmbGuideMetric, secondX, 372, colWidth);
        }

        private static void LayoutSetting(Label label, Control input, int x, int y, int width)
        {
            label.Bounds = new Rectangle(x, y, width, 19);
            input.Bounds = new Rectangle(x, y + 21, width, 28);
            input.AccessibleName = label.Text;
        }

        private void LayoutConnections(int width)
        {
            _lblBrowserProfile.Bounds = new Rectangle(16, 53, 170, 25);
            _cmbBrowserProfile.Bounds = new Rectangle(194, 48, Math.Max(180, width - 210), 30);

            Label[] labels = { _pokeLoginState, _twitchLoginState, _kickLoginState };
            Control[] buttons = { _btnLoginPokeIdle, _btnLoginTwitch, _btnLoginKick };
            for (int i = 0; i < labels.Length; i++)
            {
                int y = 92 + i * 45;
                labels[i].Bounds = new Rectangle(16, y + 7, width - 214, 25);
                buttons[i].Bounds = new Rectangle(width - 188, y, 172, 33);
            }
            _btnImportLiveTokens.Bounds = new Rectangle(16, 232, 186, 33);
            _btnImportSession.Bounds = new Rectangle(width - 368, 232, 172, 33);
            _btnReloadSess.Bounds = new Rectangle(width - 188, 232, 172, 33);
            _lblLivesHead.Bounds = new Rectangle(16, 47, width - 32, 21);
            _lblLivesTw.Bounds = new Rectangle(16, 75, width - 32, 36);
            _lblLivesKk.Bounds = new Rectangle(16, 120, width - 32, 36);
        }

        private void SetupTrayIcon()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("Abrir Painel Desktop", null, (s, e) => RestoreFromTray());
            menu.Items.Add("Abrir Painel Web", null, (s, e) => OpenWebPanel());
            menu.Items.Add("Abrir Lives Oficiais", null, (s, e) => SendActionAsync("open-lives"));
            var accounts = new ToolStripMenuItem("Paineis por conta");
            for (int i = 1; i <= 4; i++)
            {
                int account = i;
                if (account == _account) continue;
                accounts.DropDownItems.Add("Conta " + account, null, (s, e) =>
                    Process.Start(Application.ExecutablePath, "--account " + account));
            }
            menu.Items.Add(accounts);
            menu.Items.Add("-");
            menu.Items.Add("Iniciar / Reconectar", null, (s, e) => SendActionAsync("start"));
            menu.Items.Add("Pausar (Navegador)", null, (s, e) => SendActionAsync("pause"));
            menu.Items.Add("Restock Agora", null, (s, e) => SendActionAsync("restock-now"));
            menu.Items.Add("-");
            menu.Items.Add("Sair do Nexo PokeBot", null, (s, e) => Close());

            _trayIcon = new NotifyIcon
            {
                Icon = Icon ?? SystemIcons.Application,
                Text = "Nexo PokeBot v1.0",
                ContextMenuStrip = menu,
                Visible = true,
            };
            _trayIcon.DoubleClick += (s, e) => RestoreFromTray();
        }

        private void MinimizeToTray()
        {
            Hide();
            ShowInTaskbar = false;
            if (_trayIcon != null)
            {
                _trayIcon.ShowBalloonTip(1500, "PokeBot Desktop", "Continuando em segundo plano na bandeja.", ToolTipIcon.Info);
            }
        }

        private void RestoreFromTray()
        {
            Show();
            WindowState = FormWindowState.Normal;
            ShowInTaskbar = true;
            Activate();
        }

        private void OpenWebPanel()
        {
            SendActionAsync("open-panel");
        }

        private static string FindChromiumBrowserExe()
        {
            string configured = Environment.GetEnvironmentVariable("POKEBOT_BROWSER_EXE");
            if (!string.IsNullOrWhiteSpace(configured)) return File.Exists(configured) ? configured : null;
            string[] candidates = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
            };
            try
            {
                const string key = @"HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice";
                string id = Convert.ToString(Microsoft.Win32.Registry.GetValue(key, "ProgId", ""));
                string preferred = id.StartsWith("MSEdgeHTM", StringComparison.OrdinalIgnoreCase) ? "msedge.exe"
                    : id.StartsWith("BraveHTML", StringComparison.OrdinalIgnoreCase) ? "brave.exe"
                    : id.StartsWith("ChromeHTML", StringComparison.OrdinalIgnoreCase) ? "chrome.exe" : "";
                foreach (string path in candidates)
                    if (Path.GetFileName(path) == preferred && File.Exists(path)) return path;
            }
            catch (System.Security.SecurityException) { }
            catch (UnauthorizedAccessException) { }
            foreach (string c in candidates)
            {
                if (!string.IsNullOrEmpty(c) && File.Exists(c)) return c;
            }
            return null;
        }

        private void LoadPokemonSpriteAsync(int speciesId, bool shiny)
        {
            if (speciesId <= 0) return;
            string key = speciesId + ":" + (shiny ? "1" : "0");
            if (key == _lastSpriteKey) return;
            _lastSpriteKey = key;

            Image cached;
            if (_spriteCache.TryGetValue(key, out cached))
            {
                _spriteFrame.SetSprite(cached);
                return;
            }

            string url = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/" + (shiny ? "shiny/" : "") + speciesId + ".png";
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    using (var wc = new WebClient())
                    {
                        byte[] bytes = wc.DownloadData(url);
                        using (var ms = new MemoryStream(bytes))
                        using (var raw = Image.FromStream(ms))
                        {
                            var bmp = new Bitmap(raw);
                            if (!_isClosing && IsHandleCreated)
                            {
                                BeginInvoke((Action)(() =>
                                {
                                    _spriteCache[key] = bmp;
                                    if (_lastSpriteKey == key) _spriteFrame.SetSprite(bmp);
                                }));
                            }
                        }
                    }
                }
                catch { }
            });
        }

        private void StartBackendAndPolling()
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                if (!IsBackendAlive())
                {
                    StartNodeServerProcess();
                }
                _pollTimer = new System.Threading.Timer(__ => PollServerOnce(), null, 250, 1000);
            });
        }

        private bool IsBackendAlive()
        {
            try
            {
                using (var tcp = new TcpClient())
                {
                    IAsyncResult ar = tcp.BeginConnect("127.0.0.1", ServerPort, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(150)) return false;
                    tcp.EndConnect(ar);
                }
                using (var wc = new WebClient { Proxy = null, Encoding = Encoding.UTF8 })
                {
                    string json = wc.DownloadString(BaseUrl + "/api/status");
                    return !string.IsNullOrEmpty(json);
                }
            }
            catch { return false; }
        }

        private void StartNodeServerProcess()
        {
            if (string.IsNullOrEmpty(_projectRoot))
            {
                _backendError = "Abra o executável na pasta do projeto ou em dist.";
                return;
            }
            string scriptPath = Path.Combine(_projectRoot, "src", "headless", "gui-server.mjs");
            if (!File.Exists(scriptPath)) return;

            string nodeExe = FindNodeExe();
            var psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = "\"" + scriptPath + "\" --account " + _account + " --parent-pid " + Process.GetCurrentProcess().Id,
                WorkingDirectory = _projectRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            try
            {
                _nodeProcess = Process.Start(psi);
                _ownsNodeProcess = _nodeProcess != null;
                if (_ownsNodeProcess)
                {
                    _nodeProcess.ErrorDataReceived += (s, e) =>
                    {
                        if (!string.IsNullOrWhiteSpace(e.Data) &&
                            (e.Data.Contains("Error") || e.Data.Contains("Node.js")))
                            _backendError = e.Data;
                    };
                    _nodeProcess.BeginErrorReadLine();
                }
            }
            catch (Exception err) { _backendError = "Falha ao iniciar Node.js: " + err.Message; }
        }

        private void PollServerOnce()
        {
            if (_isClosing) return;
            if (!Monitor.TryEnter(_pollLock)) return;
            try
            {
                using (var wc = new WebClient { Proxy = null, Encoding = Encoding.UTF8 })
                {
                    string raw = wc.DownloadString(BaseUrl + "/api/status");
                    var data = _json.Deserialize<Dictionary<string, object>>(raw);
                    if (!_isClosing && IsHandleCreated && data != null)
                    {
                        BeginInvoke((Action)(() => ApplySnapshot(data)));
                    }
                }
            }
            catch
            {
                if (!_isClosing && IsHandleCreated)
                {
                    BeginInvoke((Action)(() =>
                    {
                        _statusPill.SetStatus("OFFLINE", Theme.Red, Color.FromArgb(45, 18, 26));
                        _lblTrainerLine.Text = "Conta " + _account + "  ·  " + (_backendError ?? "Aguardando servidor local…");
                    }));
                }
            }
            finally
            {
                Monitor.Exit(_pollLock);
            }
        }

        private void SendActionAsync(string action, Dictionary<string, object> extra = null, Action<bool> onComplete = null)
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    var body = new Dictionary<string, object> { { "action", action } };
                    if (extra != null)
                    {
                        foreach (var kv in extra) body[kv.Key] = kv.Value;
                    }
                    using (var wc = new WebClient { Proxy = null, Encoding = Encoding.UTF8 })
                    {
                        wc.Headers[HttpRequestHeader.ContentType] = "application/json";
                        wc.UploadString(BaseUrl + "/api/action", "POST", _json.Serialize(body));
                    }
                    if (onComplete != null && !_isClosing && IsHandleCreated)
                        BeginInvoke((Action)(() => onComplete(true)));
                    PollServerOnce();
                }
                catch (WebException wex)
                {
                    string detail = wex.Message;
                    try
                    {
                        if (wex.Response != null)
                        {
                            using (var sr = new StreamReader(wex.Response.GetResponseStream(), Encoding.UTF8))
                            {
                                string errBody = sr.ReadToEnd();
                                var errObj = _json.Deserialize<Dictionary<string, object>>(errBody);
                                string serverErr = Str(errObj, "error", "");
                                if (!string.IsNullOrEmpty(serverErr)) detail = serverErr;
                            }
                        }
                    }
                    catch { }

                    if (!_isClosing && IsHandleCreated)
                    {
                        BeginInvoke((Action)(() =>
                        {
                            if (onComplete != null) onComplete(false);
                            MessageBox.Show(this, detail, "PokeBot");
                        }));
                    }
                }
                catch (Exception err)
                {
                    if (!_isClosing && IsHandleCreated)
                    {
                        BeginInvoke((Action)(() =>
                        {
                            if (onComplete != null) onComplete(false);
                            MessageBox.Show(this, "Falha ao enviar o comando ao servidor local. " + err.Message, "PokeBot");
                        }));
                    }
                }
            });
        }

        private void SetConfigDirty(bool dirty)
        {
            _configDirty = dirty;
            _btnSaveCfg.Enabled = dirty && !_savingConfig;
            _configHint.Text = _savingConfig ? "Salvando alterações…" : dirty ? "Alterações pendentes" : "";
            _configHint.ForeColor = dirty ? Theme.Amber : Theme.TextMuted;
        }

        private void SaveConfig()
        {
            var cfg = new Dictionary<string, object>
            {
                { "caidosEnabled", _chkCaidos.Checked },
                { "economyMode", _chkEconomy.Checked ? "on" : "auto" },
                { "economyPingOnly", _chkEconomyPingOnly.Checked },
                { "standbyOn4001", _chkStandby.Checked },
                { "restockEnabled", _chkRestock.Checked },
                { "dailyPassEnabled", _chkPass.Checked },
                { "preyEnabled", _chkPrey.Checked },
                { "ensureNativeAutoHeal", _chkNativeHeal.Checked },
                { "liveEnabled", _chkLives.Checked },
                { "preferredBall", _cmbBallNormal.SelectedItem != null ? _cmbBallNormal.SelectedItem.ToString() : "auto" },
                { "shinyBall", _cmbBallShiny.SelectedItem != null ? _cmbBallShiny.SelectedItem.ToString() : "best" },
                { "liveRewardType", _cmbLiveReward.SelectedItem != null ? _cmbLiveReward.SelectedItem.ToString() : "xp" },
                { "huntGuideMode", GuideModes[Math.Max(0, _cmbGuideMode.SelectedIndex)] },
                { "huntGuideMetric", GuideMetrics[Math.Max(0, _cmbGuideMetric.SelectedIndex)] },
                { "liveMaxTwitchSlots", (int)_numLiveTwitchSlots.Value },
                { "liveMaxKickSlots", (int)_numLiveKickSlots.Value },
                { "targetBalls", (int)_numTargetBalls.Value },
                { "targetPotions", (int)_numTargetPotions.Value },
                { "targetRevives", (int)_numTargetRevives.Value },
                { "restockRevive", _numTargetRevives.Value > 0 },
                { "minGoldReserve", _numReserveGold.Value },
            };
            _savingConfig = true;
            SetConfigDirty(false);
            SendActionAsync("set-config", new Dictionary<string, object> { { "config", cfg } }, success =>
            {
                _savingConfig = false;
                SetConfigDirty(!success || _configDirty);
                if (success && !_configDirty) _configHint.Text = "Alterações salvas";
            });
        }

        private void ShowImportLiveTokensDialog()
        {
            using (var dlg = new Form())
            {
                dlg.Text = "Colar tokens Twitch / Kick - Conta " + _account;
                dlg.Size = new Size(540, 290);
                dlg.StartPosition = FormStartPosition.CenterParent;
                dlg.FormBorderStyle = FormBorderStyle.FixedDialog;
                dlg.MaximizeBox = false;
                dlg.MinimizeBox = false;
                dlg.BackColor = Theme.BgWindow;
                dlg.ForeColor = Theme.TextPrimary;
                dlg.Font = new Font("Segoe UI", 9f);

                dlg.HandleCreated += (s, e) =>
                {
                    try
                    {
                        int useDark = 1;
                        if (DwmSetWindowAttribute(dlg.Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref useDark, 4) != 0)
                            DwmSetWindowAttribute(dlg.Handle, DWMWA_USE_IMMERSIVE_DARK_MODE_OLD, ref useDark, 4);
                        int captionBgr = 0x001A0E09;
                        DwmSetWindowAttribute(dlg.Handle, DWMWA_CAPTION_COLOR, ref captionBgr, 4);
                    }
                    catch { }
                };

                var lblInfo = new Label
                {
                    Text = "No navegador onde você já está logado, abra F12 -> Application -> Cookies e copie o valor de auth-token (twitch.tv) e/ou session_token (kick.com):",
                    Location = new Point(16, 14),
                    Size = new Size(492, 38),
                    ForeColor = Theme.TextMuted,
                    BackColor = Color.Transparent,
                };
                var lblTw = new Label
                {
                    Text = "Twitch (cookie auth-token):",
                    Location = new Point(16, 62),
                    Size = new Size(492, 18),
                    ForeColor = Theme.TextPrimary,
                    BackColor = Color.Transparent,
                    Font = new Font("Segoe UI", 8.4f, FontStyle.Bold),
                };
                var txtTw = new TextBox
                {
                    Location = new Point(16, 84),
                    Size = new Size(492, 24),
                    BackColor = Theme.BgInput,
                    ForeColor = Theme.TextPrimary,
                    BorderStyle = BorderStyle.FixedSingle,
                    UseSystemPasswordChar = true,
                    Font = new Font("Consolas", 9f),
                };
                var lblKk = new Label
                {
                    Text = "Kick (cookie session_token):",
                    Location = new Point(16, 122),
                    Size = new Size(492, 18),
                    ForeColor = Theme.TextPrimary,
                    BackColor = Color.Transparent,
                    Font = new Font("Segoe UI", 8.4f, FontStyle.Bold),
                };
                var txtKk = new TextBox
                {
                    Location = new Point(16, 144),
                    Size = new Size(492, 24),
                    BackColor = Theme.BgInput,
                    ForeColor = Theme.TextPrimary,
                    BorderStyle = BorderStyle.FixedSingle,
                    UseSystemPasswordChar = true,
                    Font = new Font("Consolas", 9f),
                };
                var btnCancel = new PillButton
                {
                    Text = "Cancelar",
                    Location = new Point(298, 198),
                    Size = new Size(98, 34),
                };
                var btnConfirm = new PillButton
                {
                    Text = "Salvar tokens",
                    BgColor = Theme.Blue,
                    BorderColor = Theme.BlueLight,
                    Location = new Point(404, 198),
                    Size = new Size(104, 34),
                };

                btnCancel.Click += (s, e) => dlg.Close();
                btnConfirm.Click += (s, e) =>
                {
                    string tw = (txtTw.Text ?? "").Trim();
                    string kk = (txtKk.Text ?? "").Trim();
                    if (string.IsNullOrEmpty(tw) && string.IsNullOrEmpty(kk))
                    {
                        MessageBox.Show(dlg, "Informe pelo menos um token (Twitch ou Kick).", "PokeBot");
                        return;
                    }
                    btnConfirm.Enabled = false;
                    SendActionAsync("import-live-tokens", new Dictionary<string, object>
                    {
                        { "twitchToken", tw },
                        { "kickToken", kk },
                    }, ok =>
                    {
                        if (ok) dlg.Close();
                        else btnConfirm.Enabled = true;
                    });
                };

                dlg.Controls.AddRange(new Control[] { lblInfo, lblTw, txtTw, lblKk, txtKk, btnCancel, btnConfirm });
                dlg.ShowDialog(this);
            }
        }

        private void ShowImportSessionDialog()
        {
            using (var dlg = new Form())
            {
                dlg.Text = "Colar sessão do PokeIdle - Conta " + _account;
                dlg.Size = new Size(560, 320);
                dlg.MinimumSize = new Size(460, 280);
                dlg.StartPosition = FormStartPosition.CenterParent;
                dlg.FormBorderStyle = FormBorderStyle.FixedDialog;
                dlg.MaximizeBox = false;
                dlg.MinimizeBox = false;
                dlg.BackColor = Theme.BgWindow;
                dlg.ForeColor = Theme.TextPrimary;
                dlg.Font = new Font("Segoe UI", 9f);

                dlg.HandleCreated += (s, e) =>
                {
                    try
                    {
                        int useDark = 1;
                        if (DwmSetWindowAttribute(dlg.Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref useDark, 4) != 0)
                            DwmSetWindowAttribute(dlg.Handle, DWMWA_USE_IMMERSIVE_DARK_MODE_OLD, ref useDark, 4);
                        int captionBgr = 0x001A0E09;
                        DwmSetWindowAttribute(dlg.Handle, DWMWA_CAPTION_COLOR, ref captionBgr, 4);
                    }
                    catch { }
                };

                var lblInfo = new Label
                {
                    Text = "Cole o JSON copiado pelo botão \"Copiar Sessão Headless\" no HUD ou pelo comando localStorage.getItem('sessao') no console do navegador:",
                    Location = new Point(16, 14),
                    Size = new Size(512, 38),
                    ForeColor = Theme.TextMuted,
                    BackColor = Color.Transparent,
                };
                var txtRaw = new TextBox
                {
                    Multiline = true,
                    ScrollBars = ScrollBars.Vertical,
                    Location = new Point(16, 58),
                    Size = new Size(512, 166),
                    BackColor = Theme.BgInput,
                    ForeColor = Theme.TextPrimary,
                    BorderStyle = BorderStyle.FixedSingle,
                    Font = new Font("Consolas", 8.8f),
                };
                var btnPaste = new PillButton
                {
                    Text = "Colar da área de transferência",
                    Location = new Point(16, 236),
                    Size = new Size(200, 34),
                };
                var btnCancel = new PillButton
                {
                    Text = "Cancelar",
                    Location = new Point(318, 236),
                    Size = new Size(98, 34),
                };
                var btnConfirm = new PillButton
                {
                    Text = "Importar",
                    BgColor = Theme.Blue,
                    BorderColor = Theme.BlueLight,
                    Location = new Point(424, 236),
                    Size = new Size(104, 34),
                };

                btnPaste.Click += (s, e) =>
                {
                    try
                    {
                        if (Clipboard.ContainsText()) txtRaw.Text = Clipboard.GetText().Trim();
                    }
                    catch { }
                };
                btnCancel.Click += (s, e) => dlg.Close();
                btnConfirm.Click += (s, e) =>
                {
                    string raw = (txtRaw.Text ?? "").Trim();
                    if (string.IsNullOrEmpty(raw))
                    {
                        MessageBox.Show(dlg, "Cole o JSON ou token da sessão antes de importar.", "PokeBot");
                        return;
                    }
                    btnConfirm.Enabled = false;
                    SendActionAsync("import-session", new Dictionary<string, object> { { "raw", raw } }, ok =>
                    {
                        if (ok) dlg.Close();
                        else btnConfirm.Enabled = true;
                    });
                };

                dlg.Controls.AddRange(new Control[] { lblInfo, txtRaw, btnPaste, btnCancel, btnConfirm });
                dlg.ShowDialog(this);
            }
        }

        private void ApplySnapshot(Dictionary<string, object> data)
        {
            string status = Str(data, "status", "disconnected");
            ApplyStatusBadge(status);
            _btnReloadSess.Text = string.IsNullOrEmpty(Str(data, "browserProfile", ""))
                ? "Recarregar sessão" : "Usar sessão do Chrome";

            var profiles = List(data, "browserProfiles");
            string profileSetting = Str(data, "browserProfileSetting", "");
            if (profiles != null && profiles.Count > 0)
            {
                var sigBuilder = new StringBuilder();
                sigBuilder.Append(profileSetting).Append("|");
                for (int i = 0; i < profiles.Count; i++)
                {
                    var p = profiles[i] as Dictionary<string, object>;
                    if (p == null) continue;
                    sigBuilder.Append(Str(p, "id", "")).Append("=").Append(Str(p, "label", "")).Append(";");
                }
                string profSig = sigBuilder.ToString();
                if (profSig != _lastProfileSignature && !_cmbBrowserProfile.DroppedDown)
                {
                    _lastProfileSignature = profSig;
                    _loadingProfile = true;
                    try
                    {
                        _cmbBrowserProfile.BeginUpdate();
                        _cmbBrowserProfile.Items.Clear();
                        int selIdx = 0;
                        for (int i = 0; i < profiles.Count; i++)
                        {
                            var p = profiles[i] as Dictionary<string, object>;
                            if (p == null) continue;
                            string id = Str(p, "id", "");
                            string label = Str(p, "label", id);
                            _cmbBrowserProfile.Items.Add(new ProfileItem { Id = id, Label = label });
                            if (id == profileSetting) selIdx = _cmbBrowserProfile.Items.Count - 1;
                        }
                        if (_cmbBrowserProfile.Items.Count > 0) _cmbBrowserProfile.SelectedIndex = selIdx;
                        _cmbBrowserProfile.EndUpdate();
                    }
                    finally { _loadingProfile = false; }
                }
            }

            var trainer = Dict(data, "trainer");
            var st = Dict(data, "stats");
            string nick = Str(trainer, "nick", "-");
            long gold = NumLong(trainer, "gold");
            int level = NumInt(trainer, "level");
            int uptimeSec = NumInt(st, "uptimeSec");
            int pongs = NumInt(st, "pongs");
            bool eco = Bool(trainer, "economyActive");

            _lblTrainerLine.Text = string.Format(
                "Conta {0}  ·  {1} (Nv {2})  ·  {3:N0} gold  ·  {4}  ·  {5} pings",
                _account, nick, level, gold, FormatUptime(uptimeSec), pongs
            );
            string lastError = Str(data, "lastError", "");
            if (!string.IsNullOrEmpty(lastError) && status != "connected" && status != "bridge")
                _lblTrainerLine.Text = "Conta " + _account + "  ·  " + lastError;

            var poke = Dict(data, "activePokemon");
            if (poke != null)
            {
                bool isShiny = Bool(poke, "shiny");
                string pName = Str(poke, "name", "-");
                int pLv = NumInt(poke, "level");
                int hp = NumInt(poke, "hp");
                int maxHp = Math.Max(1, NumInt(poke, "maxHp"));
                int hpPct = NumInt(poke, "hpPercent");
                int speciesId = NumInt(poke, "speciesId");
                _lblActivePoke.Text = (isShiny ? "★ " : "") + pName + " Nv " + pLv;
                _hpBar.SetHp(hpPct, string.Format("{0:N0} / {1:N0} HP ({2}%)", hp, maxHp, hpPct));
                LoadPokemonSpriteAsync(speciesId, isShiny);
            }
            else
            {
                _lblActivePoke.Text = "Aguardando Pokémon";
                _hpBar.SetHp(0, "0 / 0 HP");
            }

            string huntName = Str(trainer, "huntName", "-");
            string huntSlug = Str(trainer, "huntSlug", "");
            bool noCentro = Bool(trainer, "noCentro");
            var guide = Dict(data, "huntGuide");
            string guideSlug = Str(guide, "slug", "");
            string guideNote = Str(guide, "note", "");
            string guideMode = Str(Dict(data, "config"), "huntGuideMode", "off");
            string huntLine = string.Format("Hunt atual: {0}{1}  ·  Economia {2}", huntName, noCentro ? " (Centro)" : "", eco ? "ativa" : "inativa");
            if (guideMode != "off" && !string.IsNullOrEmpty(guideNote))
            {
                huntLine += "  ·  /hunt: " + guideNote;
            }
            _lblHuntInfo.Text = huntLine;
            if (guideMode == "notify" && !Bool(guide, "sameHunt") && !string.IsNullOrEmpty(guideSlug))
            {
                string alert = Str(guide, "metric", "") + "/" + guideSlug;
                if (_lastHuntGuideAlert != alert)
                {
                    _lastHuntGuideAlert = alert;
                    if (_trayIcon != null)
                        _trayIcon.ShowBalloonTip(4000, "Melhor hunt · Conta " + _account,
                            Str(guide, "note", guideSlug), ToolTipIcon.Info);
                }
            }
            else if (guideMode != "notify" || Bool(guide, "sameHunt"))
            {
                _lastHuntGuideAlert = "";
            }

            var hunts = List(data, "hunts");
            if (hunts != null)
            {
                string sig = hunts.Count + ":" + huntSlug;
                if (sig != _lastHuntSignature && !_cmbHunts.DroppedDown)
                {
                    _lastHuntSignature = sig;
                    _cmbHunts.BeginUpdate();
                    _cmbHunts.Items.Clear();
                    int selIdx = -1;
                    for (int i = 0; i < hunts.Count; i++)
                    {
                        var h = hunts[i] as Dictionary<string, object>;
                        if (h == null) continue;
                        string s = Str(h, "slug", "");
                        string n = Str(h, "nome", s);
                        int lv = NumInt(h, "nivel");
                        _cmbHunts.Items.Add(new HuntItem { Slug = s, Label = n + " (Nv " + lv + ")" });
                        if (s == huntSlug) selIdx = _cmbHunts.Items.Count - 1;
                    }
                    if (selIdx >= 0) _cmbHunts.SelectedIndex = selIdx;
                    _cmbHunts.EndUpdate();
                }
            }

            _kpiKills.LblValue.Text = string.Format("{0:N0}", NumLong(st, "kills"));
            _kpiKills.LblSub.Text = string.Format("{0}/min", Str(st, "killsPerMin", "0"));
            _kpiXp.LblValue.Text = string.Format("{0:N0}", NumLong(st, "xpGained"));
            _kpiXp.LblSub.Text = string.Format("{0:N0}/h", NumLong(st, "xpPerHour"));
            _kpiGold.LblValue.Text = string.Format("{0:N0}", NumLong(st, "goldGained"));
            _kpiGold.LblSub.Text = string.Format("{0:N0}/h", NumLong(st, "goldPerHour"));
            _kpiCaps.LblValue.Text = string.Format("{0:N0}", NumLong(st, "captures"));
            _kpiCaps.LblSub.Text = string.Format("{0} shinies · {1:N0} bolas", NumLong(st, "shiniesCaptured"), NumLong(st, "ballsThrown"));

            var inv = Dict(data, "inventory");
            var balls = Dict(inv, "balls");
            var items = Dict(inv, "items");
            _invPoke.Text = NumLong(balls, "1").ToString("N0");
            _invGreat.Text = NumLong(balls, "2").ToString("N0");
            _invSuper.Text = NumLong(balls, "3").ToString("N0");
            _invUltra.Text = NumLong(balls, "4").ToString("N0");
            _invBeast.Text = NumLong(balls, "5").ToString("N0");
            _invPotion.Text = NumLong(items, "200").ToString("N0");
            _invRevive.Text = NumLong(items, "205").ToString("N0");

            var lives = Dict(data, "lives");
            if (lives != null)
            {
                bool lvOn = Bool(lives, "enabled");
                string lvReward = Str(lives, "rewardType", "xp");
                bool hasTw = Bool(lives, "hasTwitchToken");
                bool hasKk = Bool(lives, "hasKickToken");
                long lvMin = NumLong(lives, "minutesWatched");
                long lvBaus = NumLong(lives, "chestsClaimed");
                long lvResg = NumLong(lives, "rewardsRedeemed");
                string loginProg = Str(data, "loginInProgress", "");
                _currentLoginInProgress = loginProg;

                _btnLoginTwitch.Enabled = string.IsNullOrEmpty(loginProg) || loginProg == "twitch";
                _btnLoginKick.Enabled = string.IsNullOrEmpty(loginProg) || loginProg == "kick";
                _btnLoginPokeIdle.Enabled = string.IsNullOrEmpty(loginProg) || loginProg == "pokeidle";

                bool gameConnected = status == "connected" || status == "bridge";
                _pokeLoginState.Text = "PokeIdle  ·  " + (loginProg == "pokeidle" ? "Aguardando login no navegador…" : (gameConnected ? nick : "Conta " + _account));
                _twitchLoginState.Text = "Twitch  ·  " + (loginProg == "twitch" ? "Faça login no Chrome e feche a janela…" : (hasTw ? "Conectada" : "Desconectada"));
                _kickLoginState.Text = "Kick  ·  " + (loginProg == "kick" ? "Faça login no Chrome e feche a janela…" : (hasKk ? "Conectada" : "Desconectada"));
                _btnLoginTwitch.Text = loginProg == "twitch" ? "Cancelar login" : (hasTw ? "Reconectar Twitch" : "Conectar Twitch");
                _btnLoginKick.Text = loginProg == "kick" ? "Cancelar login" : (hasKk ? "Reconectar Kick" : "Conectar Kick");
                _btnLoginPokeIdle.Text = loginProg == "pokeidle" ? "Cancelar login" : (gameConnected ? "Trocar conta" : "Logar PokeIdle");

                _lblLivesHead.Text = string.Format(
                    "{0}  ·  {1} min assistidos  ·  {2} baús +50  ·  {3} resgates",
                    lvOn ? lvReward.ToUpperInvariant() : "Coleta automática desativada", lvMin, lvBaus, lvResg
                );
                _lblLivesTw.Text = "Twitch: " + (hasTw ? FormatLiveChannels(Dict(lives, "twitch")) : "desconectada");
                _lblLivesKk.Text = "Kick: " + (hasKk ? FormatLiveChannels(Dict(lives, "kick")) : "desconectada");
            }

            var cfg = Dict(data, "config");
            if (!_configDirty && !_savingConfig && cfg != null)
            {
                _chkCaidos.SetCheckedQuiet(Bool(cfg, "caidosEnabled"));
                _chkEconomy.SetCheckedQuiet(Str(cfg, "economyMode", "auto") == "on");
                _chkEconomyPingOnly.SetCheckedQuiet(Bool(cfg, "economyPingOnly"));
                _chkStandby.SetCheckedQuiet(Bool(cfg, "standbyOn4001"));
                _chkRestock.SetCheckedQuiet(Bool(cfg, "restockEnabled"));
                _chkPass.SetCheckedQuiet(Bool(cfg, "dailyPassEnabled"));
                _chkPrey.SetCheckedQuiet(Bool(cfg, "preyEnabled"));
                _chkNativeHeal.SetCheckedQuiet(Bool(cfg, "ensureNativeAutoHeal"));
                _chkLives.SetCheckedQuiet(Bool(cfg, "liveEnabled"));

                _loadingConfig = true;
                try
                {
                    SelectComboString(_cmbBallNormal, Str(cfg, "preferredBall", "auto"));
                    SelectComboString(_cmbBallShiny, Str(cfg, "shinyBall", "best"));
                    SelectComboString(_cmbLiveReward, Str(cfg, "liveRewardType", "xp"));
                _cmbGuideMode.SelectedIndex = Math.Max(0, Array.IndexOf(GuideModes, Str(cfg, "huntGuideMode", "off")));
                _cmbGuideMetric.SelectedIndex = Math.Max(0, Array.IndexOf(GuideMetrics, Str(cfg, "huntGuideMetric", "xp")));
                }
                finally { _loadingConfig = false; }

                if (cfg.ContainsKey("liveMaxTwitchSlots")) _numLiveTwitchSlots.SetValueQuiet(NumLong(cfg, "liveMaxTwitchSlots"));
                if (cfg.ContainsKey("liveMaxKickSlots")) _numLiveKickSlots.SetValueQuiet(NumLong(cfg, "liveMaxKickSlots"));
                _numTargetBalls.SetValueQuiet(NumLong(cfg, "targetBalls"));
                _numTargetPotions.SetValueQuiet(NumLong(cfg, "targetPotions"));
                _numTargetRevives.SetValueQuiet(Bool(cfg, "restockRevive") ? NumLong(cfg, "targetRevives") : 0);
                _numReserveGold.SetValueQuiet(NumLong(cfg, "minGoldReserve"));
            }

            var logList = List(data, "logs");
            if (logList != null && logList.Count > 0)
            {
                var last = logList[logList.Count - 1] as Dictionary<string, object>;
                int topId = last != null ? NumInt(last, "id") : 0;
                if (topId != _lastLogId)
                {
                    _lastLogId = topId;
                    RenderColoredLogs(logList);
                }
            }
        }

        private void RenderColoredLogs(ArrayList logList)
        {
            _rtbLogs.SuspendLayout();
            try
            {
                _rtbLogs.Clear();
                foreach (object item in logList)
                {
                    var l = item as Dictionary<string, object>;
                    if (l == null) continue;
                    string time = Str(l, "time", "--:--:--");
                    string kind = Str(l, "kind", "info");
                    string text = Str(l, "text", "");

                    _rtbLogs.SelectionColor = Theme.TextDim;
                    _rtbLogs.AppendText("[" + time + "] ");

                    Color msgColor = Theme.TextPrimary;
                    if (kind == "ok") msgColor = Theme.GreenBright;
                    else if (kind == "shiny") msgColor = Color.FromArgb(250, 204, 21);
                    else if (kind == "catch") msgColor = Color.FromArgb(196, 181, 253);
                    else if (kind == "reward") msgColor = Color.FromArgb(251, 146, 60);
                    else if (kind == "shop" || kind == "prey") msgColor = Color.FromArgb(56, 189, 248);
                    else if (kind == "warn") msgColor = Theme.Amber;
                    else if (kind == "error") msgColor = Color.FromArgb(248, 113, 113);

                    _rtbLogs.SelectionColor = msgColor;
                    _rtbLogs.AppendText(text + Environment.NewLine);
                }
                _rtbLogs.SelectionStart = _rtbLogs.TextLength;
                _rtbLogs.ScrollToCaret();
            }
            finally
            {
                _rtbLogs.ResumeLayout();
            }
        }

        private void ApplyStatusBadge(string status)
        {
            if (status == "connected")
            {
                _statusPill.SetStatus("FARMANDO", Theme.GreenBright, Color.FromArgb(15, 48, 38));
            }
            else if (status == "bridge")
            {
                _statusPill.SetStatus("ACOPLADO · ON", Color.FromArgb(45, 212, 191), Color.FromArgb(14, 48, 52));
            }
            else if (status == "standby")
            {
                _statusPill.SetStatus("STANDBY", Theme.Amber, Color.FromArgb(52, 36, 14));
            }
            else if (status == "paused")
            {
                _statusPill.SetStatus("PAUSADO", Theme.TextMuted, Color.FromArgb(30, 41, 59));
            }
            else if (status == "connecting")
            {
                _statusPill.SetStatus("CONECTANDO", Theme.BlueLight, Color.FromArgb(20, 38, 72));
            }
            else if (status == "error")
            {
                _statusPill.SetStatus("ERRO", Theme.Red, Color.FromArgb(56, 20, 28));
            }
            else
            {
                _statusPill.SetStatus("OFFLINE", Theme.TextDim, Color.FromArgb(25, 33, 48));
            }
        }

        private static void SelectComboString(ComboBox cmb, string val)
        {
            int idx = cmb.Items.IndexOf(val);
            if (idx >= 0 && cmb.SelectedIndex != idx) cmb.SelectedIndex = idx;
        }

        private void OnMainFormClosing(object sender, FormClosingEventArgs e)
        {
            _isClosing = true;
            if (_pollTimer != null)
            {
                _pollTimer.Dispose();
                _pollTimer = null;
            }
            if (_trayIcon != null)
            {
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
                _trayIcon = null;
            }

            if (_ownsNodeProcess)
            {
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(BaseUrl + "/api/action");
                    req.Method = "POST";
                    req.Proxy = null;
                    req.Timeout = 1500;
                    req.ReadWriteTimeout = 1500;
                    req.ContentType = "application/json";
                    byte[] bytes = Encoding.UTF8.GetBytes("{\"action\":\"shutdown\"}");
                    req.ContentLength = bytes.Length;
                    using (Stream s = req.GetRequestStream())
                    {
                        s.Write(bytes, 0, bytes.Length);
                    }
                    using (WebResponse resp = req.GetResponse()) { }
                }
                catch { }

                if (_nodeProcess != null)
                {
                    try
                    {
                        if (!_nodeProcess.HasExited && !_nodeProcess.WaitForExit(1200))
                        {
                            _nodeProcess.Kill();
                        }
                    }
                    catch { }
                    _nodeProcess.Dispose();
                    _nodeProcess = null;
                }
            }
        }

        private static string BrowserProfileDir(string projectRoot, int account)
        {
            string root = account == 1 ? projectRoot : Path.Combine(projectRoot, ".pokebot-accounts", account.ToString());
            return Path.Combine(root, ".pokebot-browser-profile");
        }

        private static string ReadConfiguredBrowserProfile(string projectRoot, int account)
        {
            try
            {
                string dir = account == 1 ? projectRoot : Path.Combine(projectRoot, ".pokebot-accounts", account.ToString());
                string cfgPath = Path.Combine(dir, ".pokebot-headless-config.json");
                if (!File.Exists(cfgPath)) return "";
                var js = new JavaScriptSerializer();
                var cfg = js.Deserialize<Dictionary<string, object>>(File.ReadAllText(cfgPath, Encoding.UTF8));
                return Str(cfg, "browserProfile", "");
            }
            catch { return ""; }
        }

        internal static bool TryLaunchEcoDaemon()
        {
            string root = FindProjectRoot();
            string nodeExe = FindNodeExe();
            if (string.IsNullOrEmpty(root) || string.IsNullOrEmpty(nodeExe)) return false;
            string daemonScript = Path.Combine(root, "src", "headless", "multi-daemon.mjs");
            if (!File.Exists(daemonScript)) return false;
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = "\"" + daemonScript + "\"",
                    WorkingDirectory = root,
                    UseShellExecute = true,
                });
                return true;
            }
            catch
            {
                return false;
            }
        }

        internal static bool TryRunSelfUpdate(out string failureReason)
        {
            failureReason = null;
            string root = FindProjectRoot();
            if (string.IsNullOrEmpty(root))
            {
                failureReason = "Pasta do Nexo PokeBot não encontrada para atualizar.";
                return false;
            }
            string updaterScript = Path.Combine(root, "src", "desktop", "updater.mjs");
            if (!File.Exists(updaterScript))
            {
                failureReason = "Módulo de atualização não encontrado em:\n" + updaterScript;
                return false;
            }
            string electronDist = Path.Combine(root, "node_modules", "electron", "dist");
            string brandedExe = Path.Combine(electronDist, "Nexo PokeBot.exe");
            string fallbackExe = Path.Combine(electronDist, "electron.exe");
            string runtimeExe = File.Exists(brandedExe) ? brandedExe : (File.Exists(fallbackExe) ? fallbackExe : FindNodeExe());
            bool asNode = runtimeExe.Equals(brandedExe, StringComparison.OrdinalIgnoreCase) ||
                          runtimeExe.Equals(fallbackExe, StringComparison.OrdinalIgnoreCase);
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = runtimeExe,
                    Arguments = "\"" + updaterScript + "\" --apply",
                    WorkingDirectory = root,
                    UseShellExecute = false,
                };
                if (asNode) psi.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
                Process.Start(psi);
                return true;
            }
            catch (Exception ex)
            {
                failureReason = "Não foi possível iniciar o atualizador:\n" + ex.Message;
                return false;
            }
        }

        internal static bool TryLaunchElectronHub(out string failureReason)
        {
            failureReason = null;
            string root = FindProjectRoot();
            if (string.IsNullOrEmpty(root))
            {
                failureReason =
                    "Pasta do projeto não encontrada.\n\n" +
                    "Extraia TODO o conteúdo do arquivo ZIP para uma pasta antes de abrir o Nexo PokeBot.exe " +
                    "(não abra só o .exe isolado nem direto de dentro do ZIP).";
                return false;
            }
            string mainScript = Path.Combine(root, "src", "electron", "main.mjs");
            if (!File.Exists(mainScript))
            {
                failureReason =
                    "Arquivos do Nexo PokeBot não encontrados em:\n" + mainScript +
                    "\n\nExtraia a pasta completa do pacote mais recente.";
                return false;
            }
            string electronDist = Path.Combine(root, "node_modules", "electron", "dist");
            string brandedExe = Path.Combine(electronDist, "Nexo PokeBot.exe");
            string fallbackExe = Path.Combine(electronDist, "electron.exe");
            string electronExe = File.Exists(brandedExe) ? brandedExe : fallbackExe;
            if (!File.Exists(electronExe))
            {
                failureReason =
                    "Runtime do Nexo PokeBot (Electron) não encontrado em:\n" + brandedExe +
                    "\n\nUse o ZIP completo (Nexo-PokeBot-v1.0.zip) ou rode 'npm ci' na pasta do projeto.";
                return false;
            }
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = electronExe,
                    Arguments = "\"" + mainScript + "\"",
                    WorkingDirectory = root,
                    UseShellExecute = false,
                });
                return true;
            }
            catch (Exception ex)
            {
                failureReason = "Falha ao iniciar o Nexo PokeBot: " + ex.Message;
                return false;
            }
        }

        internal static void OpenExtensions(int account)
        {
            string browser = FindChromiumBrowserExe();
            string root = FindProjectRoot();
            if (browser == null || root == null)
            {
                MessageBox.Show("Abra o PokeBot na pasta do projeto e verifique se Chrome ou Edge está instalado.");
                return;
            }
            string profile = BrowserProfileDir(root, account);
            string configuredProfile = ReadConfiguredBrowserProfile(root, account);
            string profileArgs;
            if (!string.IsNullOrEmpty(configuredProfile) && configuredProfile != "isolated")
            {
                profileArgs = "--profile-directory=\"" + configuredProfile + "\" ";
            }
            else if (account == 1 && configuredProfile != "isolated")
            {
                profileArgs = "";
            }
            else
            {
                profileArgs = "--user-data-dir=\"" + profile + "\" ";
            }
            string extensionsUrl = Path.GetFileName(browser).Equals("msedge.exe", StringComparison.OrdinalIgnoreCase)
                ? "edge://extensions" : "chrome://extensions";
            Process.Start(new ProcessStartInfo
            {
                FileName = browser,
                Arguments = profileArgs + "--no-first-run --no-default-browser-check --new-window " + extensionsUrl,
                UseShellExecute = false,
            });
        }

        private static string FindProjectRoot()
        {
            var probes = new List<string>
            {
                AppDomain.CurrentDomain.BaseDirectory,
                Environment.CurrentDirectory
            };
            foreach (string start in probes)
            {
                if (string.IsNullOrEmpty(start)) continue;
                DirectoryInfo dir = new DirectoryInfo(start);
                for (int i = 0; i < 4 && dir != null; i++)
                {
                    if (File.Exists(Path.Combine(dir.FullName, "src", "headless", "gui-server.mjs")))
                    {
                        return dir.FullName;
                    }
                    dir = dir.Parent;
                }
            }
            return null;
        }

        private static string FindNodeExe()
        {
            string[] fixedCandidates = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe"),
            };
            foreach (string c in fixedCandidates)
            {
                if (File.Exists(c)) return c;
            }
            return "node.exe";
        }

        private static string FormatLiveChannels(Dictionary<string, object> map)
        {
            if (map == null || map.Count == 0) return "nenhuma live online";
            var parts = new List<string>();
            foreach (var kv in map)
            {
                var info = kv.Value as Dictionary<string, object>;
                if (info != null && info.ContainsKey("error") && info["error"] != null)
                {
                    parts.Add(kv.Key + " (" + Convert.ToString(info["error"]) + ")");
                    if (parts.Count >= 4) break;
                    continue;
                }
                bool live = info != null && Bool(info, "live");
                if (!live) continue;
                string bal = info != null && info.ContainsKey("balance") && info["balance"] != null
                    ? Convert.ToString(info["balance"])
                    : "?";
                parts.Add(kv.Key + " (ON · " + bal + ")");
                if (parts.Count >= 4) break;
            }
            return parts.Count > 0 ? string.Join("  |  ", parts.ToArray()) : "nenhuma live online";
        }

        private static string FormatUptime(int totalSec)
        {
            int h = totalSec / 3600;
            int m = (totalSec % 3600) / 60;
            int s = totalSec % 60;
            return string.Format("{0:00}:{1:00}:{2:00}", h, m, s);
        }

        private static Dictionary<string, object> Dict(Dictionary<string, object> obj, string key)
        {
            if (obj == null || !obj.ContainsKey(key)) return null;
            return obj[key] as Dictionary<string, object>;
        }

        private static ArrayList List(Dictionary<string, object> obj, string key)
        {
            if (obj == null || !obj.ContainsKey(key)) return null;
            return obj[key] as ArrayList;
        }

        private static string Str(Dictionary<string, object> obj, string key, string fallback)
        {
            if (obj == null || !obj.ContainsKey(key) || obj[key] == null) return fallback;
            return Convert.ToString(obj[key]);
        }

        private static int NumInt(Dictionary<string, object> obj, string key)
        {
            return (int)Math.Max(int.MinValue, Math.Min(int.MaxValue, NumLong(obj, key)));
        }

        private static long NumLong(Dictionary<string, object> obj, string key)
        {
            if (obj == null || !obj.ContainsKey(key) || obj[key] == null) return 0;
            try { return Convert.ToInt64(obj[key]); }
            catch { return 0; }
        }

        private static bool Bool(Dictionary<string, object> obj, string key)
        {
            if (obj == null || !obj.ContainsKey(key) || obj[key] == null) return false;
            try { return Convert.ToBoolean(obj[key]); }
            catch { return false; }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | (SecurityProtocolType)768 | SecurityProtocolType.Tls;
            }
            catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool legacyMode = Array.IndexOf(args, "--legacy") >= 0;
            bool ecoMode = Array.IndexOf(args, "--eco") >= 0;
            bool extMode = Array.IndexOf(args, "--extensions") >= 0;
            bool updateMode = Array.IndexOf(args, "--update") >= 0;
            int account = 1;
            int accountIndex = Array.IndexOf(args, "--account");
            if (accountIndex >= 0 && (accountIndex + 1 >= args.Length ||
                !int.TryParse(args[accountIndex + 1], out account) || account < 1 || account > 4))
            {
                MessageBox.Show("Use --account com um número de 1 a 4.");
                return;
            }
            if (updateMode)
            {
                string updErr;
                if (!PokeBotMainForm.TryRunSelfUpdate(out updErr) && !string.IsNullOrEmpty(updErr))
                {
                    MessageBox.Show(updErr, "Nexo PokeBot - Atualização", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                return;
            }
            if (ecoMode && PokeBotMainForm.TryLaunchEcoDaemon())
            {
                return;
            }
            if (!legacyMode && !extMode && accountIndex < 0)
            {
                string hubError;
                if (PokeBotMainForm.TryLaunchElectronHub(out hubError))
                {
                    return;
                }
                if (!string.IsNullOrEmpty(hubError))
                {
                    MessageBox.Show(
                        hubError + "\n\n(Para abrir o painel clássico antigo, use --legacy.)",
                        "Nexo PokeBot v1.0",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning
                    );
                    return;
                }
            }
            if (extMode)
            {
                PokeBotMainForm.OpenExtensions(account);
                return;
            }
            Application.Run(new PokeBotMainForm(account));
        }
    }
}
