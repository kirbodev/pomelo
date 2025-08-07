import {
  type APIEmbedField,
  type EmbedAuthorOptions,
  EmbedBuilder,
  type EmbedFooterOptions,
  type RestOrArray,
  type EmbedData,
  type ColorResolvable,
  type APIEmbed,
  normalizeArray,
} from "discord.js";
import { Colors } from "../lib/colors.js";
import { Utility } from "@sapphire/plugin-utilities-store";
import { EmbedLimits } from "@sapphire/discord-utilities";

const defaults: EmbedData = {
  color: Colors.Default,
  provider: {
    name: "Pomelo",
    url: "https://kdv.one/",
  },
};

export default class EmbedUtils extends Utility {
  public constructor(context: Utility.LoaderContext, options: Utility.Options) {
    super(context, {
      ...options,
      name: "embedUtils",
    });
  }
  /**
   * A class that extends the EmbedBuilder class from discord.js.
   *
   * Ensures the safety of the embed data and tries to fix it if it's not valid
   *
   * It also adds extra utility classes to the embed builder
   * @extends EmbedBuilder
   */
  static EmbedConstructor = class EmbedConstructor extends EmbedBuilder {
    public constructor(options?: EmbedData) {
      super({ ...defaults, timestamp: new Date(), ...options });
    }

    private verifyTitle(title: string) {
      if (title.length > EmbedLimits.MaximumTitleLength)
        return title.slice(0, EmbedLimits.MaximumTitleLength - 3) + "...";
      return title;
    }

    private verifyDescription(description: string) {
      if (
        description &&
        description.length > EmbedLimits.MaximumDescriptionLength
      )
        return (
          description.slice(0, EmbedLimits.MaximumDescriptionLength - 3) + "..."
        );
      return description;
    }

    private verifyFields(fields: APIEmbedField[]) {
      if (fields.length > EmbedLimits.MaximumFields)
        fields = fields.slice(0, EmbedLimits.MaximumFields - 1);
      for (const field of fields) {
        if (field.name.length > EmbedLimits.MaximumFieldNameLength)
          field.name =
            field.name.slice(0, EmbedLimits.MaximumFieldNameLength - 3) + "...";
        if (field.value.length > EmbedLimits.MaximumFieldValueLength)
          field.value =
            field.value.slice(0, EmbedLimits.MaximumFieldValueLength - 3) +
            "...";
      }
      return fields;
    }

    private verifyFooter(footer: EmbedFooterOptions) {
      if (footer.text.length > 512)
        footer.text = footer.text.slice(0, 512 - 3) + "...";
      return footer;
    }

    private verifyAuthor(author: EmbedAuthorOptions) {
      if (author.name.length > 256)
        author.name = author.name.slice(0, 256 - 3) + "...";
      return author;
    }

    private verifyEmbedLength(data: APIEmbed) {
      let totalCharacters = 0;
      if (data.title) totalCharacters += data.title.length;
      if (data.description) totalCharacters += data.description.length;
      if (data.fields) {
        for (const field of data.fields) {
          totalCharacters += field.name.length + field.value.length;
        }
      }
      if (data.footer) totalCharacters += data.footer.text.length;
      if (data.author) totalCharacters += data.author.name.length;

      if (totalCharacters > 6000) {
        if (data.description && data.description.length > 2048) {
          totalCharacters -= data.description.length;
          data.description = data.description.slice(0, 2045) + "...";
          totalCharacters += data.description.length;
        }
        if (totalCharacters > 6000 && data.fields) {
          while (totalCharacters > 6000) {
            if (data.fields.length === 0) break;
            const field = data.fields[data.fields.length - 1];
            totalCharacters -= field.name.length + field.value.length;
            data.fields.pop();
          }
        }
        // Maximum possible characters without fields is 5120, so if all fields are removed, the totalCharacters have to be less than 6000
      }
      return data;
    }

    public addField(name: string, value: string, inline = false) {
      const verified = this.verifyFields([
        ...(this.data.fields ?? []),
        { name, value, inline },
      ]);
      const newData = this.verifyEmbedLength({
        ...this.data,
        fields: verified,
      });
      super.setDescription(newData.description ?? null);
      super.setFields(newData.fields ?? []);
      return this;
    }

    public setTitle(title: string | null) {
      if (!title) return super.setTitle(title);
      const verified = this.verifyTitle(title);
      super.setTitle(verified);
      return this;
    }

    public setDescription(description: string | null) {
      if (!description) return super.setDescription(description);
      const verified = this.verifyDescription(description);
      super.setDescription(verified);
      return this;
    }

    public setFooter(footer: EmbedFooterOptions | null) {
      if (!footer) return super.setFooter(footer);
      const verified = this.verifyFooter(footer);
      super.setFooter(verified);
      return this;
    }

    public setColor(color: Colors | ColorResolvable | null) {
      if (!color) return super.setColor(Colors.Default);
      super.setColor(color);
      return this;
    }

    public setAuthor(author: EmbedAuthorOptions | null) {
      if (!author) return super.setAuthor(author);
      const verified = this.verifyAuthor(author);
      super.setAuthor(verified);
      return this;
    }

    public setThumbnail(thumbnail: string | null) {
      super.setThumbnail(thumbnail);
      return this;
    }

    public setImage(image: string | null) {
      super.setImage(image);
      return this;
    }

    public setURL(url: string | null) {
      super.setURL(url);
      return this;
    }

    public spliceFields(
      index: number,
      deleteCount: number,
      ...fields: APIEmbedField[]
    ) {
      super.spliceFields(index, deleteCount, ...fields);
      return this;
    }

    public setFields(...fields: RestOrArray<APIEmbedField>) {
      const verified = this.verifyFields(normalizeArray(fields));
      const newData = this.verifyEmbedLength({
        ...this.data,
        fields: verified,
      });
      super.setDescription(newData.description ?? null);
      super.setFields(newData.fields ?? []);
      return this;
    }

    public addFields(...fields: RestOrArray<APIEmbedField>) {
      const verified = this.verifyFields([
        ...(this.data.fields ?? []),
        ...normalizeArray(fields),
      ]);
      const newData = this.verifyEmbedLength({
        ...this.data,
        fields: verified,
      });
      super.setDescription(newData.description ?? null);
      super.setFields(newData.fields ?? []);
      return this;
    }
  };
}

declare module "@sapphire/plugin-utilities-store" {
  export interface Utilities {
    embedUtils: EmbedUtils;
  }
}
