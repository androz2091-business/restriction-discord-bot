import { Entity, Column, DataSource, PrimaryGeneratedColumn, BaseEntity, ManyToOne, JoinColumn, OneToMany } from "typeorm";
import { Database, Resource } from '@adminjs/typeorm';
import { validate } from 'class-validator';
import { RelationType, owningRelationSettingsFeature } from '@adminjs/relations';
import { componentLoader } from './component-loader.js';

import AdminJS, { ComponentLoader, ResourceOptions } from 'adminjs';
import AdminJSFastify from '@adminjs/fastify';
import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { join } from "path";

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { features } from "process";
import { client, syncServers } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

Resource.validate = validate;
AdminJS.registerAdapter({ Database, Resource });

@Entity()
export class Server extends BaseEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({
        nullable: false,
        unique: true
    })
    serverId!: string;

    @Column()
    name!: string;

    @OneToMany(() => WhitelistedEmoji, emoji => emoji.server)
    whitelistedEmojis!: WhitelistedEmoji[];

    @OneToMany(() => Keyword, keyword => keyword.server)
    keywords!: Keyword[];

}

@Entity()
export class WhitelistedEmoji extends BaseEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({
        nullable: false
    })
    emojiUnicodeOrId!: string;

    @Column({
        nullable: false
    })
    serverId!: string;

    @ManyToOne(() => Server, server => server.whitelistedEmojis)
    @JoinColumn({ name: "serverId", referencedColumnName: "serverId" })
    server!: Server;
}

@Entity()
export class Keyword extends BaseEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({
        default: 'startswith'
    })
    kind!: string;

    @Column({
        nullable: false
    })
    text!: string;

    @Column({
        nullable: false
    })
    channelId!: string;

    @Column({
        nullable: false
    })
    serverId!: string;

    @ManyToOne(() => Server, server => server.keywords)
    @JoinColumn({ name: "serverId", referencedColumnName: "serverId" })
    server!: Server;
}

const entities = [Server, WhitelistedEmoji, Keyword];

export const Postgres = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    entities,
    synchronize: process.env.ENVIRONMENT === 'development',
});

export const initialize = () => Postgres.initialize().then(async () => {
    if (process.env.ADMINJS_PORT) {
        const app = fastify();

        function getOptions(entity: typeof BaseEntity): ResourceOptions {
            switch (entity) {
                case Server:
                    return {
                        actions: {
                            kickFromServer: {
                                actionType: 'record',
                                component: false,
                                handler: (request, response, context) => {
                                    const { record, currentAdmin } = context

                                    console.log(record);

                                    const guild = client.guilds.cache.get(record?.params.serverId);
                                    guild?.leave();

                                    return {
                                        record: record,
                                        msg: 'Kicked!',
                                    }
                                },
                            },
                        },
                    };
                case WhitelistedEmoji:
                    return {
                        properties: {
                            emojiUnicodeOrId: {
                                description: 'For custom emojis, open a Discord channel, append a \\ in front of the emoji and send it.'
                            },
                        }
                    };
                case Keyword:
                    return {
                        properties: {
                            kind: {
                                availableValues: [
                                    { value: 'startswith', label: 'The message has to starts with the text' },
                                ]
                            }
                        }
                    };
                default:
                    return {};
            }
        }

        const admin = new AdminJS({
            branding: {
                companyName: 'Discord Bot'
            },
            componentLoader: componentLoader,
            resources: entities.map((entity) => ({
                resource: entity,
                options: getOptions(entity),
                features: [
                    owningRelationSettingsFeature({
                        componentLoader: componentLoader,
                        licenseKey: process.env.ADMINJS_LICENCE_KEY,
                        relations: {
                            WhitelistedEmojis: {
                                type: RelationType.OneToMany,
                                target: {
                                    joinKey: 'serverId',
                                    resourceId: 'WhitelistedEmoji',
                                },
                            },
                            Keywords: {
                                type: RelationType.OneToMany,
                                target: {
                                    joinKey: 'serverId',
                                    resourceId: 'Keyword',
                                },
                            },
                        }
                    })
                ]
            }))
        });

        admin.watch();

        app.register(fastifyStatic, {
            root: join(__dirname, '../public'),
            prefix: '/public/',
        });
        await AdminJSFastify.buildAuthenticatedRouter(admin, {
            cookiePassword: process.env.ADMINJS_COOKIE_HASH!,
            cookieName: 'adminjs',
            authenticate: async (_email, password) => {
                if (_email) return false;
                if (password === process.env.ADMINJS_PASSWORD!) {
                    return true;
                }
            }
        }, app);
        app.listen({
            host: '0.0.0.0',
            port: process.env.ADMINJS_PORT
        }, () => {
            console.log(`AdminJS is listening at http://localhost:${process.env.ADMINJS_PORT}`)
        });
    }



});
